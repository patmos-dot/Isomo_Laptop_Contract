// Storage: one SQLite file in the private data folder.
// SQLite is a full database kept in a single file, with no separate database server to run.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { PATHS, DATA_DIR, LINK_VALID_DAYS } from './config.js';

fs.mkdirSync(DATA_DIR, { recursive: true });
export const db = new DatabaseSync(PATHS.db);
// WAL: safer when the page and a staff script use the file at the same time.
// busy_timeout: if the file is busy, wait up to 5 seconds instead of failing at once.
db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');

// Runs fn as one transaction: every change inside it is saved together, or none are.
// BEGIN IMMEDIATE locks the database for writing straight away, so two submissions cannot both pass the checks.
function transaction(fn) {
  return (...args) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
}

db.exec(`
  -- One row per personal signing link. Only a hash of the link's secret is stored,
  -- so someone who copies this file still cannot open anyone's link.
  CREATE TABLE IF NOT EXISTS invites (
    id INTEGER PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    scholar_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    failed_attempts INTEGER NOT NULL DEFAULT 0
  );

  -- One row per signed contract. UNIQUE on scholar_id is what really enforces
  -- "one contract per scholar", even if two submissions arrive at the same moment.
  CREATE TABLE IF NOT EXISTS contracts (
    seq INTEGER PRIMARY KEY,
    contract_id TEXT UNIQUE,
    scholar_id TEXT NOT NULL UNIQUE,
    record_json TEXT NOT NULL,
    fingerprint TEXT,
    pdf_file TEXT,
    status TEXT NOT NULL,              -- pdf_pending, signed
    email_status TEXT NOT NULL DEFAULT 'pending', -- pending, sent, failed
    email_error TEXT,
    created_at TEXT NOT NULL
  );

  -- Submissions held for staff: a second contract for the same scholar, or a name that did not match.
  CREATE TABLE IF NOT EXISTS held_submissions (
    id INTEGER PRIMARY KEY,
    scholar_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    answers_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

export const MAX_NAME_ATTEMPTS = 5;
const now = () => new Date().toISOString();
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// --- Invites ---
export function createInvite(scholarId) {
  const token = crypto.randomBytes(32).toString('base64url'); // 43 random characters: impossible to guess
  const expires = new Date(Date.now() + LINK_VALID_DAYS * 24 * 60 * 60 * 1000);
  db.prepare(`INSERT INTO invites (token_hash, scholar_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .run(hashToken(token), scholarId, now(), expires.toISOString());
  return { token, expiresAt: expires };
}

// Returns the invite only if it can still be used. Otherwise returns null, without saying why.
export function findUsableInvite(token) {
  if (typeof token !== 'string' || token.length > 100) return null;
  const invite = db.prepare(`SELECT * FROM invites WHERE token_hash = ?`).get(hashToken(token));
  if (!invite || invite.used_at || invite.expires_at < now() || invite.failed_attempts >= MAX_NAME_ATTEMPTS) return null;
  return invite;
}

export function recordFailedAttempt(inviteId) {
  db.prepare(`UPDATE invites SET failed_attempts = failed_attempts + 1 WHERE id = ?`).run(inviteId);
}

// --- Contracts ---
export function hasContract(scholarId) {
  return Boolean(db.prepare(`SELECT 1 FROM contracts WHERE scholar_id = ?`).get(scholarId));
}

export function holdSubmission(scholarId, reason, answers) {
  db.prepare(`INSERT INTO held_submissions (scholar_id, reason, answers_json, created_at) VALUES (?, ?, ?, ?)`)
    .run(scholarId, reason, JSON.stringify(answers), now());
}

// Everything inside a transaction happens completely or not at all.
// makeRecord receives the new sequence number and returns the full contract record.
export const reserveContract = transaction((invite, answers, makeRecord) => {
  // Check again inside the transaction, so two tabs submitting at once cannot both pass.
  const fresh = db.prepare(`SELECT used_at FROM invites WHERE id = ?`).get(invite.id);
  if (fresh.used_at) return { outcome: 'link_used' };
  db.prepare(`UPDATE invites SET used_at = ? WHERE id = ?`).run(now(), invite.id);

  if (hasContract(invite.scholar_id)) {
    holdSubmission(invite.scholar_id, 'duplicate', answers);
    return { outcome: 'held' };
  }

  const { lastInsertRowid: seq } = db.prepare(
    `INSERT INTO contracts (scholar_id, record_json, status, created_at) VALUES (?, '{}', 'pdf_pending', ?)`,
  ).run(invite.scholar_id, now());
  const record = makeRecord(Number(seq));
  db.prepare(`UPDATE contracts SET contract_id = ?, record_json = ?, fingerprint = ? WHERE seq = ?`)
    .run(record.contractId, JSON.stringify(record), record.fingerprint, seq);
  return { outcome: 'created', contractId: record.contractId };
});

export function getContract(contractId) {
  return db.prepare(`SELECT * FROM contracts WHERE contract_id = ?`).get(contractId);
}

export function unfinishedContracts() {
  return db.prepare(`SELECT * FROM contracts WHERE status != 'signed' OR email_status != 'sent' ORDER BY seq`).all();
}

export function markPdfDone(contractId, pdfFile) {
  db.prepare(`UPDATE contracts SET status = 'signed', pdf_file = ? WHERE contract_id = ?`).run(pdfFile, contractId);
}

export function markEmail(contractId, status, error = null) {
  db.prepare(`UPDATE contracts SET email_status = ?, email_error = ? WHERE contract_id = ?`).run(status, error, contractId);
}
