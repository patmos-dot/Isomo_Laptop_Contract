// The web page scholars open from their personal link.
//   GET  /sign/<link>  shows the contract with their details filled in, and the form
//   POST /sign/<link>  checks the answers, signs, makes the PDF, and emails it
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import Handlebars from 'handlebars';
import { HOST, PORT, ROOT, TEMPLATES_DIR, ROSTER_FILE, CONTACT_EMAIL } from './config.js';
import { findScholar } from './roster.js';
import { LIMITS, closeBrowser } from './contract.js';
import { findUsableInvite } from './db.js';
import { validateAnswers, signContract, finishContract, log } from './signing.js';

// --- Page templates ---
const hbs = Handlebars.create();
const read = (...p) => fs.readFileSync(path.join(TEMPLATES_DIR, ...p), 'utf8');
hbs.registerPartial('terms', read( 'terms.hbs'));
hbs.registerPartial('acceptance', read( 'acceptance.hbs'));
hbs.registerHelper('eq', (a, b) => a === b);
const views = {
  layout: hbs.compile(read( 'layout.hbs')),
  form: hbs.compile(read( 'form.hbs')),
  message: hbs.compile(read( 'message.hbs')),
};

function render(res, status, view, data) {
  res.status(status).type('html').send(views.layout({ title: data.title, body: views[view](data) }));
}

const NO_MATCH = `We could not match your details. Contact ${CONTACT_EMAIL}.`;
const LINK_NOT_VALID = {
  title: 'This link cannot be used',
  lines: ['This signing link is not valid, has already been used, or has expired.', `Contact ${CONTACT_EMAIL} for a new link.`],
};

// --- Rate limit: a small counter per visitor address ---
// Behind Cloudflare Tunnel every request comes from the tunnel, so the visitor's real address
// is read from the CF-Connecting-IP header. This is safe only because the server listens on
// 127.0.0.1 (see HOST), so nobody can reach it without going through Cloudflare.
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (v.resetAt < t) hits.delete(k); }, windowMs).unref();
  return (req, res, next) => {
    const key = req.get('CF-Connecting-IP') || req.socket.remoteAddress;
    const entry = hits.get(key) || { count: 0, resetAt: Date.now() + windowMs };
    if (entry.resetAt < Date.now()) { entry.count = 0; entry.resetAt = Date.now() + windowMs; }
    entry.count += 1;
    hits.set(key, entry);
    if (entry.count > max) {
      log('rate_limited');
      return render(res, 429, 'message', { title: 'Please wait', lines: ['Too many attempts. Wait 15 minutes, then try again.'] });
    }
    next();
  };
}

// --- App ---
const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    'Referrer-Policy': 'no-referrer', // the link must never leak to other sites
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store', // pages show personal details: do not keep copies
  });
  next();
});

app.use('/assets', express.static(path.join(ROOT, 'public'), { maxAge: '1h' }));
// Small size limit: anything larger than a filled-in form is rejected.
app.use(express.urlencoded({ extended: false, limit: '16kb', parameterLimit: 20 }));

app.get('/', (req, res) => render(res, 200, 'message', {
  title: 'Isomo laptop release contract',
  lines: ['Open the personal link in your email to sign your contract.', `Questions: ${CONTACT_EMAIL}`],
}));

function formData(scholar, answers = {}, errors = {}, formError = null) {
  return { title: 'Sign your laptop release contract', scholar, answers, errors, formError, limits: LIMITS, contactEmail: CONTACT_EMAIL };
}

const signLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });

app.get('/sign/:token', signLimiter, (req, res) => {
  const invite = findUsableInvite(req.params.token);
  const scholar = invite && findScholar(ROSTER_FILE, invite.scholar_id);
  if (!scholar) { log('invalid_link'); return render(res, 404, 'message', LINK_NOT_VALID); }
  render(res, 200, 'form', formData(scholar));
});

app.post('/sign/:token', signLimiter, async (req, res, next) => {
  try {
    const invite = findUsableInvite(req.params.token);
    const scholar = invite && findScholar(ROSTER_FILE, invite.scholar_id);
    if (!scholar) { log('invalid_link'); return render(res, 404, 'message', LINK_NOT_VALID); }

    const { answers, errors } = validateAnswers(req.body || {});
    if (Object.keys(errors).length) {
      log('missing_fields');
      return render(res, 422, 'form', formData(scholar, answers, errors, 'Some items need your attention.'));
    }

    const result = signContract(invite, answers);
    log(result.outcome, result.contractId);

    if (result.outcome === 'no_match') {
      return render(res, 422, 'form', formData(scholar, answers, {}, NO_MATCH));
    }
    if (result.outcome === 'link_used') return render(res, 409, 'message', LINK_NOT_VALID);
    if (result.outcome === 'held') {
      return render(res, 200, 'message', {
        title: 'We received your form',
        lines: ['Our records show a contract for you already. Staff will review this form and contact you.', `Questions: ${CONTACT_EMAIL}`],
      });
    }

    // The contract is saved before the PDF and email. If either fails, staff run "npm run retry"
    // and the scholar does not need to sign again.
    try {
      await finishContract(result.contractId);
    } catch (err) {
      log('finish_failed', result.contractId);
      console.error(err.name, err.message.split('\n')[0]);
    }
    render(res, 200, 'message', {
      title: 'Your contract is signed',
      lines: [
        'Thank you. A copy of your signed contract will arrive by email.',
        `Your Contract ID is ${result.contractId}. Keep it for your records.`,
        `If the email does not arrive within a day, contact ${CONTACT_EMAIL}.`,
      ],
    });
  } catch (err) {
    next(err);
  }
});

app.use((req, res) => render(res, 404, 'message', { title: 'Page not found', lines: ['Open the personal link in your email.'] }));

// Errors: show a plain message and log only the error type.
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const tooLarge = err.type === 'entity.too.large' || err.type === 'parameters.too.many';
  log(tooLarge ? 'too_large' : `error_${err.name || 'Error'}`);
  if (!tooLarge) console.error(err.name, String(err.message).split('\n')[0]);
  render(res, tooLarge ? 413 : 500, 'message', {
    title: 'Something went wrong',
    lines: [tooLarge ? 'The form was too large to send.' : 'The form could not be saved.', `Contact ${CONTACT_EMAIL}.`],
  });
});

const server = app.listen(PORT, HOST, () => console.log(`Listening on http://${HOST}:${PORT}`));

async function shutdown() {
  server.close();
  await closeBrowser();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
