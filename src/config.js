// All settings in one place.
// Values that differ per machine, or are secret, come from .env.
// Values that describe the contract itself are written here, so they change together with the template in Git.
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The project folder. Relative paths in .env are resolved from here,
// not from wherever Node happens to be started.
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fromRoot = (p) => path.resolve(ROOT, p);

// --- Contract identity (change these when the wording in templates/partials changes) ---
export const CONTRACT_VERSION = '2026.3';
export const CONTRACT_REVISION = 1;
export const CONTACT_EMAIL = 'isomoadmin@bridge2rwanda.org';

// Contract IDs look like LRC-2026-0001 (LRC = laptop release contract).
// Proposed format: confirm with the owner before real use.
export function formatContractId(year, sequence) {
  return `LRC-${year}-${String(sequence).padStart(4, '0')}`;
}

// --- Machine settings from .env ---
export const DATA_DIR = fromRoot(process.env.DATA_DIR || '../isomo-contract-data');
export const ROSTER_FILE = fromRoot(process.env.ROSTER_FILE || path.join(DATA_DIR, 'roster.csv'));

// The server listens only on this computer by default. Cloudflare Tunnel connects to it locally.
export const HOST = process.env.HOST || '127.0.0.1';
export const PORT = Number(process.env.PORT || 3000);
export const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
export const LINK_VALID_DAYS = Number(process.env.LINK_VALID_DAYS || 14);

// Email.
// MAIL_MODE=preview writes each email to DATA_DIR/outbox as a .eml file and sends nothing.
// MAIL_MODE=smtp sends for real.
export const MAIL_MODE = process.env.MAIL_MODE || 'preview';
export const MAIL_FROM = process.env.MAIL_FROM || `Isomo <${CONTACT_EMAIL}>`;
export const SMTP = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT || 465),
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
};
// While testing, every email goes to this one address instead of the scholar.
export const MAIL_TEST_RECIPIENT = (process.env.MAIL_TEST_RECIPIENT || '').trim();
// Real scholars receive email only when this is exactly "yes" (owner approval, step 7).
export const MAIL_SEND_TO_SCHOLARS = process.env.MAIL_SEND_TO_SCHOLARS === 'yes';

// Optional: use an installed Chrome instead of the one Puppeteer downloads.
export const CHROME_PATH = process.env.CHROME_PATH || undefined;
export const CHROME_NO_SANDBOX = process.env.CHROME_NO_SANDBOX === '1';

// Folders inside DATA_DIR.
export const PATHS = {
  db: path.join(DATA_DIR, 'contracts.db'),
  pdfs: path.join(DATA_DIR, 'contracts'),
  outbox: path.join(DATA_DIR, 'outbox'),
  testPdfs: path.join(DATA_DIR, 'test-pdfs'),
};

export const TEMPLATES_DIR = path.join(ROOT, 'contract-template');