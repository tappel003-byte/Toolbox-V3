/**
 * Report Builder autosave: page order and active page persist on the Customer File.
 * Run: node tests/report-builder-persist.mjs
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
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('toolbox', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(['customerFiles', 'media'], 'readwrite');
    transaction.objectStore('customerFiles').clear();
    transaction.objectStore('media').clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  const record = window.ToolboxApp.blankCustomerFile('rb-persist');
  window.ToolboxPlanSetup.ensurePlanSetup(record);
  record.firstName = 'Pat';
  record.lastName = 'Nguyen';
  record.propertyAddress = '12 Persist Lane';
  await window.ToolboxDB.saveCustomerFile(record);
});

await page.goto(`${BASE}#/file/rb-persist/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelector('.rb-cover__name')?.textContent === 'Pat Nguyen');
await page.waitForFunction(() => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''), {
  timeout: 10000,
});

await page.click('.rb-thumb[data-page-id="section-discussion"]');
await page.waitForFunction(() => document.querySelector('.rb-sheet').getAttribute('data-page-id') === 'section-discussion');
await page.click('#rb-page-earlier');
await page.waitForFunction(() => {
  const captions = [...document.querySelectorAll('.rb-thumb__caption')].map((n) => n.textContent);
  return captions.indexOf('Diagnostics') === captions.indexOf('Discussion') + 1;
});
await page.waitForFunction(() => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''), {
  timeout: 10000,
});

const beforeLeave = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('rb-persist');
  const captions = (record.reportBuilder?.pages || []).map((p) => p.railLabel || p.title);
  return {
    activePageId: record.reportBuilder?.activePageId || '',
    discussionBeforeDiagnostics:
      captions.indexOf('Discussion') < captions.indexOf('Diagnostics') &&
      captions.indexOf('Diagnostics') === captions.indexOf('Discussion') + 1,
    pageCount: captions.length,
  };
});
check('reorder + active page persisted before leaving',
  beforeLeave.activePageId === 'section-discussion' && beforeLeave.discussionBeforeDiagnostics,
  JSON.stringify(beforeLeave));

await page.goto(`${BASE}#/file/rb-persist`, { waitUntil: 'networkidle0' });
await page.goto(`${BASE}#/file/rb-persist/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelector('.rb-sheet')?.getAttribute('data-page-id') === 'section-discussion', {
  timeout: 10000,
});
const restored = await page.evaluate(() => {
  const captions = [...document.querySelectorAll('.rb-thumb__caption')].map((n) => n.textContent);
  return {
    active: document.querySelector('.rb-sheet')?.getAttribute('data-page-id') || '',
    discussionBeforeDiagnostics:
      captions.indexOf('Discussion') < captions.indexOf('Diagnostics') &&
      captions.indexOf('Diagnostics') === captions.indexOf('Discussion') + 1,
    saveStatus: document.querySelector('#rb-save-status')?.textContent || '',
  };
});
check('reopening Report Builder restores saved page order and active page',
  restored.active === 'section-discussion' && restored.discussionBeforeDiagnostics,
  JSON.stringify(restored));
check('restored session shows Saved status', /^Saved/.test(restored.saveStatus), restored.saveStatus);

await page.screenshot({ path: `${OUT}/report-builder-persist.png`, fullPage: false });
await writeFile(`${OUT}/report-builder-persist.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
if (failed.length) process.exit(1);
