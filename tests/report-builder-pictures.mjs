/**
 * Report Builder Slice 2: Pictures pages, caption persist, jump-return, reconcile.
 * Run: node tests/report-builder-pictures.mjs
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

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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

await page.evaluate(async (png) => {
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

  const record = window.ToolboxApp.blankCustomerFile('rb-pictures');
  window.ToolboxPlanSetup.ensurePlanSetup(record);
  record.firstName = 'Ada';
  record.lastName = 'Mitchell';
  record.propertyAddress = '15 Picture Lane';
  const canvasId = record.planSetup.canvases[0].id;
  await window.ToolboxDB.putMedia('ph-pic-1', png);
  await window.ToolboxDB.putMedia('ph-pic-2', png);
  record.distress = {
    mode: 'internal',
    startNum: 1,
    nextNum: 3,
    activeCanvasId: canvasId,
    pins: [
      {
        id: 'pin-a',
        num: 1,
        x: 0.3,
        y: 0.4,
        canvasId,
        location: 'Foyer',
        description: 'Front door starting picture',
        photos: [{ id: 'ph-pic-1' }],
      },
      {
        id: 'pin-b',
        num: 2,
        x: 0.6,
        y: 0.5,
        canvasId,
        location: 'Living Room',
        description: 'Hairline crack upper corner',
        photos: [{ id: 'ph-pic-2' }],
      },
    ],
  };
  await window.ToolboxDB.saveCustomerFile(record);
}, TINY_PNG);

await page.goto(`${BASE}#/file/rb-pictures/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelector('.rb-shell'), { timeout: 15000 });
await page.waitForFunction(() => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''), {
  timeout: 15000,
});

const assembled = await page.evaluate(() => {
  const captions = [...document.querySelectorAll('.rb-thumb__caption')].map((n) => n.textContent);
  const picturesBtn = document.querySelector('.rb-thumb[data-page-id^="pictures-"]');
  return {
    captions,
    hasPictures: captions.some((c) => /^Pictures/.test(c || '')),
    picturesId: picturesBtn?.getAttribute('data-page-id') || '',
  };
});
check('assembled Pictures page in rail', assembled.hasPictures, JSON.stringify(assembled));

if (assembled.picturesId) {
  await page.click(`.rb-thumb[data-page-id="${assembled.picturesId}"]`);
  await page.waitForFunction(
    (id) => document.querySelector('.rb-sheet')?.getAttribute('data-page-id') === id,
    { timeout: 10000 },
    assembled.picturesId,
  );
}

await page.waitForFunction(() => document.querySelectorAll('.rb-pictures-page__cell').length >= 2, {
  timeout: 15000,
});

const grid = await page.evaluate(() => {
  const labels = [...document.querySelectorAll('.rb-pictures-page__label')].map((n) => n.textContent);
  const captions = [...document.querySelectorAll('.rb-pictures-page__caption')].map((n) => n.value);
  return { labels, captions, figure: document.querySelector('.rb-pictures-page__figure-num')?.textContent || '' };
});
check(
  'Pictures grid shows Photo NN and seeded captions',
  grid.labels.includes('Photo 01') &&
    grid.labels.includes('Photo 02') &&
    grid.captions.some((c) => /Front door/.test(c)) &&
    /Figure/.test(grid.figure),
  JSON.stringify(grid),
);

await page.evaluate(() => {
  const field = document.querySelector('[data-rb-caption="ph-pic-1"]');
  if (!field) throw new Error('caption field missing');
  field.focus();
  field.value = 'Edited foyer caption for report';
  field.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForFunction(() => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''), {
  timeout: 10000,
});

const persistedCaption = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('rb-pictures');
  const pictures = (record.reportBuilder?.pages || []).find((p) => p.type === 'pictures');
  return pictures?.reportText?.captions?.['ph-pic-1'] || '';
});
check('edited caption autosaved on Customer File', persistedCaption === 'Edited foyer caption for report', persistedCaption);

// Jump-return: leave for Distress, see return chrome, restore page.
await page.click('[data-rb-source="distress"]');
await page.waitForFunction(() => location.hash.includes('/distress'), { timeout: 10000 });
await page.waitForFunction(() => {
  const iframe = document.querySelector('iframe');
  return !!iframe;
}, { timeout: 10000 });

const session = await page.evaluate(() => {
  const raw = sessionStorage.getItem('toolbox.reportReturn');
  return raw ? JSON.parse(raw) : null;
});
check(
  'jump writes report return session',
  session && session.customerFileId === 'rb-pictures' && session.pageId === assembled.picturesId,
  JSON.stringify(session),
);

await page.waitForFunction(() => {
  const iframe = document.querySelector('iframe');
  try {
    const doc = iframe?.contentDocument;
    const btn = doc?.getElementById('hostReturnReport');
    return btn && !btn.hidden;
  } catch {
    return false;
  }
}, { timeout: 15000 });

await page.evaluate(() => {
  const iframe = document.querySelector('iframe');
  const btn = iframe.contentDocument.getElementById('hostReturnReport');
  btn.click();
});
await page.waitForFunction(() => location.hash.endsWith('/report'), { timeout: 10000 });
await page.waitForFunction(
  (id) => document.querySelector('.rb-sheet')?.getAttribute('data-page-id') === id,
  { timeout: 15000 },
  assembled.picturesId,
);
const restoredPage = await page.evaluate(() => document.querySelector('.rb-sheet')?.getAttribute('data-page-id') || '');
check('return restores left Pictures page', restoredPage === assembled.picturesId, restoredPage);

// Reconcile: add a third photo in Distress, reopen report, keep edited caption, add new slot.
await page.evaluate(async (png) => {
  const record = await window.ToolboxDB.getCustomerFile('rb-pictures');
  await window.ToolboxDB.putMedia('ph-pic-3', png);
  record.distress.pins.push({
    id: 'pin-c',
    num: 3,
    x: 0.5,
    y: 0.5,
    canvasId: record.planSetup.canvases[0].id,
    location: 'Hall',
    description: 'New pin from quick capture path',
    photos: [{ id: 'ph-pic-3' }],
  });
  record.distress.nextNum = 4;
  await window.ToolboxDB.saveCustomerFile(record);
}, TINY_PNG);

await page.goto(`${BASE}#/file/rb-pictures`, { waitUntil: 'networkidle0' });
await page.goto(`${BASE}#/file/rb-pictures/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelector('.rb-shell'), { timeout: 15000 });
await page.waitForFunction(() => {
  const btn = document.querySelector('.rb-thumb[data-page-id^="pictures-"]');
  return !!btn;
}, { timeout: 15000 });
await page.click('.rb-thumb[data-page-id^="pictures-"]');
await page.waitForFunction(() => document.querySelectorAll('.rb-pictures-page__cell').length >= 3, {
  timeout: 15000,
});

const reconciled = await page.evaluate(async () => {
  const record = await window.ToolboxDB.getCustomerFile('rb-pictures');
  const pictures = (record.reportBuilder?.pages || []).find((p) => p.type === 'pictures');
  const labels = [...document.querySelectorAll('.rb-pictures-page__label')].map((n) => n.textContent);
  return {
    keys: pictures?.meta?.photoKeys || [],
    caption: pictures?.reportText?.captions?.['ph-pic-1'] || '',
    labels,
  };
});
check(
  'reconcile keeps edited caption and adds new photo',
  reconciled.caption === 'Edited foyer caption for report' &&
    reconciled.keys.includes('ph-pic-3') &&
    reconciled.labels.includes('Photo 03'),
  JSON.stringify(reconciled),
);

await page.screenshot({ path: `${OUT}/report-builder-pictures.png`, fullPage: true });
await writeFile(`${OUT}/report-builder-pictures.json`, JSON.stringify({ results }, null, 2));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
if (failed.length) process.exit(1);
