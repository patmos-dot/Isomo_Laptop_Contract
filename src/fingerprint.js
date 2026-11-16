// The fingerprint is a short code that changes if any word of the contract or any filled-in value changes.
//
// How it is made (keep this exactly the same forever, or old fingerprints cannot be checked):
//   1. Build a JSON array of [label, value] pairs in the fixed order below,
//      ending with the full contract text (the two files in templates/partials).
//   2. Hash that JSON text (UTF-8) with SHA-256.
//   3. Keep the first 16 hexadecimal characters, in uppercase.
//
// JSON is used so that a value containing a line break or a label (for example in Problems)
// can never be confused with another field.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { TEMPLATES_DIR } from './config.js';

// Windows can save files with \r\n line endings. Normalizing keeps the hash the same on every computer.
const normalizeNewlines = (text) => text.replace(/\r\n?/g, '\n');

export function contractText() {
  const read = (name) => normalizeNewlines(fs.readFileSync(path.join(TEMPLATES_DIR, name), 'utf8')).trim();
  return `${read('terms.hbs')}\n\n${read('acceptance.hbs')}`;
}

export function canonicalString(record, text = contractText()) {
  return JSON.stringify([
    ['Document', 'Isomo Laptop Release Contract'],
    ['Version', record.version],
    ['Revision', String(record.revision)],
    ['Contract ID', record.contractId],
    ['Scholar', record.scholarName],
    ['Email', record.email],
    ['Laptop serial number', record.serialNumber],
    ['Isomo year', record.isomoYear],
    ['High school', record.highSchool],
    ['Signed at (UTC)', record.signedAtIso],
    ['Laptop condition', record.condition],
    ['Charger present', record.charger],
    ['Problems', record.problems],
    ['Electronic signature', record.signature],
    ['Contract text', text],
  ]);
}

export function computeFingerprint(record, text) {
  const hash = crypto.createHash('sha256').update(canonicalString(record, text), 'utf8').digest('hex');
  return hash.slice(0, 16).toUpperCase();
}
