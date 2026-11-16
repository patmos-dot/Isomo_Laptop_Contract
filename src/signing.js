// The signing workflow, shared by the web page and the staff scripts.
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, ROSTER_FILE, PUBLIC_BASE_URL, CONTACT_EMAIL, formatContractId } from './config.js';
import { findScholar, namesMatch } from './roster.js';
import {
  CONDITIONS, CHARGER, LIMITS, cleanLine, cleanBlock,
  buildRecord, renderContractHtml, renderPdf, kigaliYear, formatKigaliTime,
} from './contract.js';
import * as store from './db.js';
import { sendMail } from './mailer.js';

// Logs carry only the Contract ID (or a short label) and the result. Never names, emails, or Problems text.
export function log(result, contractId = '-') {
  console.log(JSON.stringify({ time: new Date().toISOString(), contractId, result }));
}

// --- Staff: send a personal link ---
export async function sendInvite(scholarId) {
  const scholar = findScholar(ROSTER_FILE, scholarId);
  if (!scholar) return 'not_in_roster';
  if (store.hasContract(scholar.scholarId)) return 'already_signed';

  const { token, expiresAt } = store.createInvite(scholar.scholarId);
  const link = `${PUBLIC_BASE_URL}/sign/${token}`;
  const until = formatKigaliTime(expiresAt.toISOString()).replace(/ at .*/, '');
  await sendMail({
    to: scholar.email,
    label: 'invite',
    subject: 'Please sign your Isomo laptop release contract',
    text: [
      `Hello ${scholar.fullName},`,
      '',
      'Please review and sign your Isomo laptop release contract. It takes about five minutes.',
      '',
      link,
      '',
      `This link is only for you. Do not share it. It works once and expires on ${until}.`,
      '',
      `If you have questions, contact ${CONTACT_EMAIL}.`,
      '',
      'Isomo',
    ].join('\n'),
  });
  return 'sent';
}

// --- Scholar: check the form ---
// Returns { answers, errors }. Field errors are safe to show: they only say what is missing.
export function validateAnswers(body) {
  const answers = {
    serialNumber: cleanLine(body.serialNumber),
    condition: String(body.condition ?? ''),
    charger: String(body.charger ?? ''),
    problems: cleanBlock(body.problems),
    signature: cleanLine(body.signature),
    agree: body.agree === 'yes',
  };
  const errors = {};
  if (!answers.serialNumber) errors.serialNumber = 'Enter the serial number from the label under your laptop.';
  else if (answers.serialNumber.length > LIMITS.serialNumber) errors.serialNumber = `Use ${LIMITS.serialNumber} characters or fewer.`;
  if (!(answers.condition in CONDITIONS)) errors.condition = 'Choose the laptop condition.';
  if (!(answers.charger in CHARGER)) errors.charger = 'Choose whether the charger is present.';
  if (answers.problems.length > LIMITS.problems) errors.problems = `Use ${LIMITS.problems} characters or fewer.`;
  if (!answers.signature) errors.signature = 'Type your full name to sign.';
  else if (answers.signature.length > LIMITS.signature) errors.signature = `Use ${LIMITS.signature} characters or fewer.`;
  if (!answers.agree) errors.agree = 'Check the box to agree to the contract.';
  return { answers, errors };
}

// --- Scholar: sign ---
// outcome is one of: created, held, no_match, link_used
export function signContract(invite, answers) {
  const scholar = findScholar(ROSTER_FILE, invite.scholar_id);
  if (!scholar) {
    store.holdSubmission(invite.scholar_id, 'not_in_roster', answers);
    return { outcome: 'no_match' };
  }
  if (!namesMatch(answers.signature, scholar.fullName)) {
    store.recordFailedAttempt(invite.id);
    store.holdSubmission(invite.scholar_id, 'name_mismatch', answers);
    return { outcome: 'no_match' };
  }

  const signedAtIso = new Date().toISOString();
  const { agree, ...contractAnswers } = answers;
  return store.reserveContract(invite, contractAnswers, (seq) => buildRecord({
    scholar,
    answers: contractAnswers,
    contractId: formatContractId(kigaliYear(signedAtIso), seq),
    signedAtIso,
  }));
}

// Makes the PDF (if not made yet) and emails it (if not sent yet).
// Safe to run again: the retry script uses it for anything that failed the first time.
export async function finishContract(contractId) {
  let row = store.getContract(contractId);
  const record = JSON.parse(row.record_json);

  const pdfFile = path.join(PATHS.pdfs, `${contractId}.pdf`);
  if (row.status !== 'signed' || !fs.existsSync(pdfFile)) {
    fs.mkdirSync(PATHS.pdfs, { recursive: true });
    fs.writeFileSync(pdfFile, await renderPdf(renderContractHtml(record)));
    store.markPdfDone(contractId, pdfFile);
    log('pdf_created', contractId);
  }

  row = store.getContract(contractId);
  if (row.email_status === 'sent') return;
  const scholar = findScholar(ROSTER_FILE, record.scholarId);
  try {
    await sendMail({
      to: scholar?.email,
      label: contractId,
      subject: `Your signed Isomo laptop release contract (${contractId})`,
      text: [
        `Hello ${record.scholarName},`,
        '',
        'Thank you for signing. Your laptop release contract is attached. Keep it for your records.',
        '',
        `Contract ID: ${contractId}`,
        `Fingerprint: ${record.fingerprint}`,
        '',
        `If anything in it is wrong, contact ${CONTACT_EMAIL}.`,
        '',
        'Isomo',
      ].join('\n'),
      attachments: [{ filename: `Isomo-laptop-release-contract-${contractId}.pdf`, path: pdfFile }],
    });
    store.markEmail(contractId, 'sent');
    log('email_sent', contractId);
  } catch (err) {
    // Store only the error type, not the message, which can contain an address.
    store.markEmail(contractId, 'failed', err.code || err.name || 'Error');
    log('email_failed', contractId);
  }
}
