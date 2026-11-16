// Reads the roster CSV and looks scholars up by Scholar ID.
// Every value stays text, so an ID like 0042 is never turned into the number 42.
import fs from 'node:fs';

const REQUIRED_COLUMNS = ['scholarId', 'fullName', 'isomoYear', 'highSchool', 'email'];

// Small CSV reader. Handles commas and quotes inside quoted values, for example "Ecole ""Test"", Kigali".
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;
  const clean = text.replace(/^﻿/, ''); // remove the invisible marker Excel adds at the start

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"' && clean[i + 1] === '"') { value += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else value += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(value); value = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(value); rows.push(row); row = []; value = '';
    } else value += ch;
  }
  if (value !== '' || row.length) { row.push(value); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

let cache = { file: null, mtimeMs: 0, byId: new Map() };

// Re-reads the file only when it has changed, so staff can update the roster without restarting.
function load(file) {
  const { mtimeMs } = fs.statSync(file);
  if (cache.file === file && cache.mtimeMs === mtimeMs) return cache.byId;

  const [header, ...rows] = parseCsv(fs.readFileSync(file, 'utf8'));
  const columns = header.map((h) => h.trim());
  const missing = REQUIRED_COLUMNS.filter((c) => !columns.includes(c));
  if (missing.length) throw new Error(`Roster is missing columns: ${missing.join(', ')}`);

  const byId = new Map();
  for (const cells of rows) {
    const scholar = {};
    columns.forEach((name, i) => { scholar[name] = (cells[i] ?? '').trim(); });
    if (scholar.scholarId) byId.set(scholar.scholarId, scholar);
  }
  cache = { file, mtimeMs, byId };
  return byId;
}

export function findScholar(file, scholarId) {
  return load(file).get(String(scholarId).trim()) || null;
}

export function allScholars(file) {
  return [...load(file).values()];
}

// "  test   SCHOLAR one " and "Test Scholar One" count as the same name.
export function normalizeName(name) {
  return String(name).normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function namesMatch(typed, rosterName) {
  return normalizeName(typed) !== '' && normalizeName(typed) === normalizeName(rosterName);
}
