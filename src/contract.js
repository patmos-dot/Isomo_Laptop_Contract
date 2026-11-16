// Turns a scholar + their answers into a contract record, fills in the HTML template, and prints it to PDF.
import fs from 'node:fs';
import path from 'node:path';
import Handlebars from 'handlebars';
import puppeteer from 'puppeteer';
import {
  CONTRACT_VERSION, CONTRACT_REVISION, TEMPLATES_DIR, CHROME_PATH, CHROME_NO_SANDBOX,
} from './config.js';
import { computeFingerprint } from './fingerprint.js';

// The form's choices, and the words the contract prints for each one.
export const CONDITIONS = {
  'working-well': 'Working well',
  'working-with-problems': 'Working with existing problems',
  'not-working': 'Not working',
};
export const CHARGER = {
  yes: 'Charger present',
  no: 'Charger not present',
};

export const LIMITS = { serialNumber: 64, problems: 1000, signature: 120 };

// Trim, and squeeze runs of spaces into one. Problems keeps its line breaks.
export const cleanLine = (v) => String(v ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
export const cleanBlock = (v) => String(v ?? '').normalize('NFC').replace(/\r\n?/g, '\n').trim();

// "August 29, 2026 at 10:30 AM", always in Kigali time, whatever the server's clock zone is.
export function formatKigaliTime(iso) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Kigali', year: 'numeric', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  );
  return `${parts.month} ${parts.day}, ${parts.year} at ${parts.hour}:${parts.minute} ${parts.dayPeriod}`;
}

export function kigaliYear(iso) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Kigali', year: 'numeric' }).format(new Date(iso)));
}

// Everything the contract needs, in one plain object. This is what gets stored and fingerprinted.
export function buildRecord({ scholar, answers, contractId, signedAtIso }) {
  const record = {
    version: CONTRACT_VERSION,
    revision: CONTRACT_REVISION,
    contractId,
    scholarName: scholar.fullName,
    email: scholar.email,
    isomoYear: scholar.isomoYear,
    highSchool: scholar.highSchool,
    serialNumber: cleanLine(answers.serialNumber),
    signedAtIso,
    condition: answers.condition,
    charger: answers.charger,
    problems: cleanBlock(answers.problems),
    signature: cleanLine(answers.signature),
  };
  record.fingerprint = computeFingerprint(record);
  return record;
}

// --- HTML ---
let compiled = null;
function templates() {
  if (compiled) return compiled;
  const read = (...p) => fs.readFileSync(path.join(TEMPLATES_DIR, ...p), 'utf8');
  const hbs = Handlebars.create();
  hbs.registerPartial('terms', read('terms.hbs'));
  hbs.registerPartial('acceptance', read('acceptance.hbs'));
  compiled = {
    contract: hbs.compile(read('contract.hbs'), { strict: true }),
    css: read('contract.css'),
    logoDataUri: `data:image/png;base64,${fs.readFileSync(path.join(TEMPLATES_DIR, 'isomo-logo.png')).toString('base64')}`,
  };
  return compiled;
}

export function renderContractHtml(record) {
  const t = templates();
  // strict: true makes Handlebars throw if a placeholder has no value, instead of silently printing nothing.
  return t.contract({
    css: t.css,
    logoDataUri: t.logoDataUri,
    ...record,
    signedInKigali: formatKigaliTime(record.signedAtIso),
    conditionLabel: CONDITIONS[record.condition],
    chargerLabel: CHARGER[record.charger],
    problemsLabel: record.problems || 'No problems reported.',
  });
}

// --- PDF ---
// One hidden Chrome is started the first time it is needed and reused after that.
let browserPromise = null;
function browser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      executablePath: CHROME_PATH,
      args: CHROME_NO_SANDBOX ? ['--no-sandbox'] : [],
    });
    browserPromise.catch(() => { browserPromise = null; }); // allow a retry if Chrome failed to start
  }
  return browserPromise;
}

export async function renderPdf(html) {
  const page = await (await browser()).newPage();
  try {
    // The page loads nothing from the network: CSS and logo are already inside the HTML.
    await page.setJavaScriptEnabled(false);
    await page.setContent(html, { waitUntil: 'load' });
    return Buffer.from(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
  } finally {
    await page.close();
  }
}

export async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    browserPromise = null;
    if (b) await b.close();
  }
}
