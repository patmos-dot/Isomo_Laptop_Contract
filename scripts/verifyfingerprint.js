// Anyone: check that a contract's fingerprint matches the values saved on the server.
// Usage: npm run verify -- LRC-2026-0001 [FINGERPRINT-FROM-A-PDF]
// With a second argument, also checks a fingerprint copied from a PDF someone shows you.
import { getContract } from '../src/db.js';
import { computeFingerprint } from '../src/fingerprint.js';

const [contractId, fromPdf] = process.argv.slice(2);
if (!contractId) {
  console.error('Usage: npm run verify -- <ContractID> [fingerprint from the PDF]');
  process.exit(1);
}

const row = getContract(contractId);
if (!row) {
  console.error(`No contract ${contractId} on this server.`);
  process.exit(1);
}

const { fingerprint: stored, ...record } = JSON.parse(row.record_json);
const recomputed = computeFingerprint(record);
console.log(`Stored:     ${stored}`);
console.log(`Recomputed: ${recomputed}`);
let ok = stored === recomputed;
if (!ok) console.log('MISMATCH: the saved record or the contract text has changed since signing.');
if (fromPdf) {
  const pdfOk = fromPdf.trim().toUpperCase() === stored;
  console.log(`PDF:        ${fromPdf.trim().toUpperCase()} ${pdfOk ? '(matches)' : '(DOES NOT MATCH the saved record)'}`);
  ok = ok && pdfOk;
}
console.log(ok ? 'OK' : 'FAILED');
process.exitCode = ok ? 0 : 1;
