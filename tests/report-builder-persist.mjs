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

// The cover says what is actually corrected for. Tim, asked whether the
// decks' "Corrected for Floor Differences" or the rail's flooring is right:
// "proper English wins." Floor Survey corrects a reading for the covering
// underfoot and calls it a flooring correction everywhere else.
const coverNote = () => page.evaluate(
  () => document.querySelector('.rb-cover__corrected')?.textContent.trim() || '');
check('the cover reads "Corrected for Flooring Differences"',
  (await coverNote()) === 'Corrected for Flooring Differences', await coverNote());

// A cover built before that change carries the old line as though it had been
// typed, so a line still reading exactly as the old default takes the new one,
// while a line the investigator wrote over is his. The Customer File is
// written with Report Builder closed -- an open book autosaves its own copy
// back over anything changed underneath it.
async function coverLineAfterStoring(stored) {
  await page.goto(`${BASE}#/file/rb-persist`, { waitUntil: 'networkidle0' });
  await page.evaluate(async (text) => {
    const record = await window.ToolboxDB.getCustomerFile('rb-persist');
    const cover = (record.reportBuilder?.pages || []).find((p) => p.type === 'cover');
    cover.reportText.corrected = text;
    await window.ToolboxDB.saveCustomerFile(record);
  }, stored);
  await page.goto(`${BASE}#/file/rb-persist/report`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(
    () => (document.querySelector('.rb-cover__corrected')?.textContent || '').trim().length > 0,
    { timeout: 10000 });
  return coverNote();
}
check('an older cover takes the new wording',
  (await coverLineAfterStoring('Corrected for Floor Differences')) ===
    'Corrected for Flooring Differences');
check('a line written over is left alone',
  (await coverLineAfterStoring('Corrected for carpet and tile')) ===
    'Corrected for carpet and tile');

// A blank Customer File opens as Cover, Discussion, Floor Survey: the
// Diagnostics sheet this used to move is no longer part of the book, so the
// move under test is the Floor Survey sheet up past Discussion. What matters
// is the same thing it always was -- an order the investigator chose survives
// leaving and coming back.
const START = ['Cover', 'Discussion', 'Floor Survey'];
const MOVED = ['Cover', 'Floor Survey', 'Discussion'];
const captionsNow = () => [...document.querySelectorAll('.rb-thumb__caption')].map((n) => n.textContent);

const opened = await page.evaluate(captionsNow);
check('a blank Customer File opens as Cover, Discussion, Floor Survey',
  opened.join(' | ') === START.join(' | '), opened.join(' | '));

await page.evaluate(() => document.querySelector('.rb-thumb[data-page-id="floor-reserved"]').click());
await page.waitForFunction(() => document.querySelector('.rb-sheet').getAttribute('data-page-id') === 'floor-reserved');
await page.click('#rb-page-earlier');
await page.waitForFunction((want) => {
  const captions = [...document.querySelectorAll('.rb-thumb__caption')].map((n) => n.textContent);
  return captions.join(' | ') === want;
}, { timeout: 10000 }, MOVED.join(' | '));
await page.waitForFunction(() => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''), {
  timeout: 10000,
});

const beforeLeave = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('rb-persist');
  const captions = (record.reportBuilder?.pages || []).map((p) => p.railLabel || p.title);
  return {
    activePageId: record.reportBuilder?.activePageId || '',
    order: captions.join(' | '),
    pageCount: captions.length,
  };
});
check('reorder + active page persisted before leaving',
  beforeLeave.activePageId === 'floor-reserved' && beforeLeave.order === MOVED.join(' | '),
  JSON.stringify(beforeLeave));

await page.goto(`${BASE}#/file/rb-persist`, { waitUntil: 'networkidle0' });
await page.goto(`${BASE}#/file/rb-persist/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelector('.rb-sheet')?.getAttribute('data-page-id') === 'floor-reserved', {
  timeout: 10000,
});
const restored = await page.evaluate(() => {
  const captions = [...document.querySelectorAll('.rb-thumb__caption')].map((n) => n.textContent);
  return {
    active: document.querySelector('.rb-sheet')?.getAttribute('data-page-id') || '',
    order: captions.join(' | '),
    saveStatus: document.querySelector('#rb-save-status')?.textContent || '',
  };
});
check('reopening Report Builder restores saved page order and active page',
  restored.active === 'floor-reserved' && restored.order === MOVED.join(' | '),
  JSON.stringify(restored));
check('restored session shows Saved status', /^Saved/.test(restored.saveStatus), restored.saveStatus);

await page.screenshot({ path: `${OUT}/report-builder-persist.png`, fullPage: false });
await writeFile(`${OUT}/report-builder-persist.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
if (failed.length) process.exit(1);
