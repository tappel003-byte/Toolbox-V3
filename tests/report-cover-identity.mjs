/**
 * Cover Prepared For / address must follow Customer Information edits.
 * Run: node tests/report-cover-identity.mjs
 * Requires a static server at http://127.0.0.1:8765 (repo root).
 */
import { createRequire } from 'module';
import { mkdir, writeFile } from 'fs/promises';

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('/tmp/node_modules/puppeteer-core');
}

const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function plain(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

await page.evaluate(async () => {
  const record = window.ToolboxApp.blankCustomerFile('rb-cover-identity');
  window.ToolboxPlanSetup.ensurePlanSetup(record);
  record.firstName = 'Ada';
  record.lastName = 'Lovelace';
  record.email = 'ada@example.com';
  record.cellPhone = '505-555-0100';
  record.propertyAddress = '10 Analytical Way\nAlbuquerque, NM 87101';
  await window.ToolboxDB.saveCustomerFile(record);
});

await page.goto(`${BASE}#/file/rb-cover-identity/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelector('.rb-shell'), { timeout: 15000 });
await page.waitForFunction(() => document.querySelector('[data-rb-cover-field="name"]'), {
  timeout: 15000,
});

const first = await page.evaluate(() => ({
  name: document.querySelector('[data-rb-cover-field="name"]')?.textContent || '',
  email: document.querySelector('[data-rb-cover-field="email"]')?.textContent || '',
  phone: document.querySelector('[data-rb-cover-field="phone"]')?.textContent || '',
  street: document.querySelector('[data-rb-cover-field="street"]')?.textContent || '',
  city: document.querySelector('[data-rb-cover-field="cityLine"]')?.textContent || '',
}));
check('first open shows Customer File name', /Ada\s+Lovelace/i.test(plain(first.name)), first.name);
check('first open shows email', /ada@example\.com/i.test(plain(first.email)), first.email);
check('first open shows phone', /505-555-0100/.test(plain(first.phone)), first.phone);
check('first open shows street', /10 Analytical Way/i.test(plain(first.street)), first.street);

// Wait for autosave of seeded cover reportText (the freeze that used to stick).
await page.waitForFunction(() => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''), {
  timeout: 15000,
});

await page.evaluate(async () => {
  const rec = await window.ToolboxDB.getCustomerFile('rb-cover-identity');
  rec.firstName = 'Grace';
  rec.lastName = 'Hopper';
  rec.email = 'grace@example.com';
  rec.cellPhone = '505-555-0199';
  rec.propertyAddress = '99 Navy Yard\nSanta Fe, NM 87501';
  rec.updatedAt = new Date().toISOString();
  await window.ToolboxDB.saveCustomerFile(rec);
});

// Leave and reopen Report Builder so loadPagesFromRecord runs again.
await page.goto(`${BASE}#/file/rb-cover-identity`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelector('.cf-home, .cf-editor, .app-view'), {
  timeout: 15000,
});
await page.goto(`${BASE}#/file/rb-cover-identity/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelector('[data-rb-cover-field="name"]'), {
  timeout: 15000,
});
await page.waitForFunction(() => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''), {
  timeout: 15000,
});

const second = await page.evaluate(() => ({
  name: document.querySelector('[data-rb-cover-field="name"]')?.textContent || '',
  email: document.querySelector('[data-rb-cover-field="email"]')?.textContent || '',
  phone: document.querySelector('[data-rb-cover-field="phone"]')?.textContent || '',
  street: document.querySelector('[data-rb-cover-field="street"]')?.textContent || '',
  city: document.querySelector('[data-rb-cover-field="cityLine"]')?.textContent || '',
  savedName: null,
}));
const stored = await page.evaluate(async () => {
  const rec = await window.ToolboxDB.getCustomerFile('rb-cover-identity');
  const cover = (rec.reportBuilder && rec.reportBuilder.pages || [])
    .find((p) => p && p.type === 'cover');
  const text = cover && cover.reportText ? cover.reportText : {};
  const plainOf = (v) => {
    if (v == null) return '';
    if (window.ToolboxReportText && window.ToolboxReportText.isModel(v)) {
      return window.ToolboxReportText.toPlain(v);
    }
    return String(v);
  };
  return {
    name: plainOf(text.name),
    email: plainOf(text.email),
    phone: plainOf(text.phone),
    street: plainOf(text.street),
    city: plainOf(text.cityLine),
  };
});

check('reopen shows updated name', /Grace\s+Hopper/i.test(plain(second.name)), second.name);
check('reopen shows updated email', /grace@example\.com/i.test(plain(second.email)), second.email);
check('reopen shows updated phone', /505-555-0199/.test(plain(second.phone)), second.phone);
check('reopen shows updated street', /99 Navy Yard/i.test(plain(second.street)), second.street);
check('reopen shows updated city', /Santa Fe/i.test(plain(second.city)), second.city);
check('stale Ada name is gone', !/Ada\s+Lovelace/i.test(plain(second.name)), second.name);
check('saved cover reportText name follows CF', /Grace\s+Hopper/i.test(stored.name || ''), stored.name);
check('saved cover reportText email follows CF', /grace@example\.com/i.test(stored.email || ''), stored.email);

await page.screenshot({ path: `${OUT}/report-cover-identity-after.png`, fullPage: false });
await writeFile(`${OUT}/report-cover-identity.json`, JSON.stringify({ results, first, second, stored }, null, 2));

const failed = results.filter((r) => !r.ok);
await browser.close();
if (failed.length) {
  console.error('FAILED', failed.length);
  process.exit(1);
}
console.log('OK', results.length);
