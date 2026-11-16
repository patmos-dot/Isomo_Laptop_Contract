// Sends email, with two safety locks so nothing reaches a real scholar by accident:
//   1. MAIL_MODE=preview (the default) sends nothing and saves each email as a .eml file you can open.
//   2. MAIL_TEST_RECIPIENT redirects every email to one address the owner chose.
//   Real scholars receive email only with MAIL_MODE=smtp, no test recipient, and MAIL_SEND_TO_SCHOLARS=yes.
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { MAIL_MODE, MAIL_FROM, SMTP, MAIL_TEST_RECIPIENT, MAIL_SEND_TO_SCHOLARS, PATHS } from './config.js';

let transport = null;
function getTransport() {
  if (transport) return transport;
  if (MAIL_MODE === 'smtp') {
    if (!SMTP.user || !SMTP.pass) throw new Error('SMTP_USER and SMTP_PASS must be set in .env for MAIL_MODE=smtp');
    transport = nodemailer.createTransport({
      host: SMTP.host, port: SMTP.port, secure: SMTP.port === 465, auth: { user: SMTP.user, pass: SMTP.pass },
    });
  } else if (MAIL_MODE === 'preview') {
    transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
  } else {
    throw new Error(`Unknown MAIL_MODE "${MAIL_MODE}". Use preview or smtp.`);
  }
  return transport;
}

// Decides who really receives the email.
function deliveryAddress(intendedTo) {
  if (MAIL_TEST_RECIPIENT) return { to: MAIL_TEST_RECIPIENT, test: true };
  if (MAIL_MODE === 'preview') return { to: intendedTo, test: false }; // nothing is sent in preview
  if (!MAIL_SEND_TO_SCHOLARS) {
    throw new Error('Sending to scholars is locked. Set MAIL_TEST_RECIPIENT, or MAIL_SEND_TO_SCHOLARS=yes after owner approval.');
  }
  return { to: intendedTo, test: false };
}

export async function sendMail({ to, subject, text, attachments = [], label }) {
  const delivery = deliveryAddress(to);
  const message = {
    from: MAIL_FROM,
    to: delivery.to,
    subject: delivery.test ? `[TEST] ${subject}` : subject,
    text,
    attachments,
  };
  const info = await getTransport().sendMail(message);

  if (MAIL_MODE === 'preview') {
    fs.mkdirSync(PATHS.outbox, { recursive: true });
    const file = path.join(PATHS.outbox, `${Date.now()}-${label}.eml`);
    fs.writeFileSync(file, info.message);
    return { preview: file };
  }
  return { messageId: info.messageId };
}
