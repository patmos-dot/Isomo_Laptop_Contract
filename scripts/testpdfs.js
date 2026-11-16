// Step 2 check for the owner: makes test PDFs from the made-up roster only, then re-checks each fingerprint.
// Usage: npm run test-pdfs
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, PATHS } from '../src/config.js';
import { findScholar } from '../src/roster.js';
import { buildRecord, renderContractHtml, renderPdf, closeBrowser, LIMITS } from '../src/contract.js';
import { computeFingerprint } from '../src/mailer.js';

// Always the made-up roster, never the real one.
const TEST_ROSTER = path.join(ROOT, 'test-data', 'roster.example.csv');

const longProblems = 'Screen flickers when the lid moves. Battery lasts about one hour. '
  .repeat(20).slice(0, LIMITS.problems);

const cases = [
  {
    file: 'test-1-normal.pdf', scholarId: 'TEST-0001',
    answers: { serialNumber: 'TEST-SERIAL-001', condition: 'working-with-problems', charger: 'yes',
      problems: 'Battery lasts about one hour; small crack near the left hinge.', signature: 'Test Scholar One' },
  },
  {
    file: 'test-2-special-characters.pdf', scholarId: 'TEST-0003',
    answers: { serialNumber: 'TEST-SERIAL-003', condition: 'not-working', charger: 'no',
      problems: 'Keys < and > stick. "Fn" & Ctrl too.\nSecond line: <script>alert(1)</script>', signature: "Ange-Marie N'Test" },
  },
  {
    file: 'test-3-longest-problems.pdf', scholarId: '0042',
    answers: { serialNumber: 'TEST-SERIAL-042', condition: 'working-with-problems', charger: 'yes',
      problems: longProblems, signature: 'Test Scholar Two' },
  },
  {
    file: 'test-4-no-problems.pdf', scholarId: 'TEST-0001',
    answers: { serialNumber: 'TEST-SERIAL-001', condition: 'working-well', charger: 'yes',
      problems: '', signature: 'Test Scholar One' },
  },
];

fs.mkdirSync(PATHS.testPdfs, { recursive: true });
try {
  for (const [i, c] of cases.entries()) {
    const scholar = findScholar(TEST_ROSTER, c.scholarId);
    if (!scholar) throw new Error(`Test scholar ${c.scholarId} is missing from the test roster`);
    const record = buildRecord({
      scholar, answers: c.answers,
      contractId: `TEST-CONTRACT-${String(i + 1).padStart(4, '0')}`,
      signedAtIso: new Date().toISOString(),
    });
    const pdf = await renderPdf(renderContractHtml(record));
    const out = path.join(PATHS.testPdfs, c.file);
    fs.writeFileSync(out, pdf);

    // Recompute from the stored values, the way anyone checking a contract later would.
    const { fingerprint, ...withoutFingerprint } = record;
    const ok = computeFingerprint(withoutFingerprint) === fingerprint;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${c.file}  ID ${record.scholarId}  fingerprint ${fingerprint}`);
    if (!ok) process.exitCode = 1;
  }
  console.log(`\nPDFs saved in ${PATHS.testPdfs}`);
} finally {
  await closeBrowser();
}
