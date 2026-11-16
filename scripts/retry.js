// Staff: finish any contract whose PDF or email failed. Nobody needs to sign again.
// Usage: npm run retry
import { unfinishedContracts } from '../src/db.js';
import { finishContract } from '../src/signing.js';
import { closeBrowser } from '../src/contract.js';

const rows = unfinishedContracts();
if (!rows.length) console.log('Nothing to retry.');
try {
  for (const row of rows) {
    await finishContract(row.contract_id);
  }
} finally {
  await closeBrowser();
}
