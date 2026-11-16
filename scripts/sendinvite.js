// Staff: email personal signing links.
// Usage:
//   npm run invite -- TEST-0001 0042        send to these Scholar IDs
//   npm run invite -- --all --yes           send to everyone in the roster without a contract
// Each run creates a new link. Older unused links for the same scholar keep working until they expire.
import { ROSTER_FILE } from '../src/config.js';
import { allScholars } from '../src/roster.js';
import { sendInvite, log } from '../src/signing.js';

const args = process.argv.slice(2);
let ids = args.filter((a) => !a.startsWith('--'));

if (args.includes('--all')) {
  if (!args.includes('--yes')) {
    console.error('Sending to the whole roster needs --yes as well. Send one first and check it.');
    process.exit(1);
  }
  ids = allScholars(ROSTER_FILE).map((s) => s.scholarId);
}
if (!ids.length) {
  console.error('Usage: npm run invite -- <ScholarID> [more IDs]   or   npm run invite -- --all --yes');
  process.exit(1);
}

for (const id of ids) {
  try {
    const result = await sendInvite(id);
    console.log(`${id}: ${result}`); // Scholar IDs only, no names or emails
    log(`invite_${result}`);
  } catch (err) {
    console.log(`${id}: failed (${err.message.split('\n')[0]})`);
    process.exitCode = 1;
  }
}
