/**
 * A Diagnostics view that was added to the report is a sheet in the book.
 * Run: node tests/report-diagnostics-page.mjs   (needs a static server on 8765)
 *
 * Diagnostics has been able to capture a 3D elevation and write it onto the
 * Customer File for some time, and Report Builder has been able to draw one;
 * what was missing was the step between -- nothing put the figure in the
 * book, so Add to Report stored a view nobody could reach. The page builder
 * that would have done it was removed in October as unreachable code.
 *
 * A Diagnostics sheet follows the Floor Survey figure it was drawn from,
 * takes the next figure number, and is listed in CONTENTS with the rest. It
 * carries the shared figure rail -- residence, drawing title, survey date,
 * the level's high / low / difference, FIGURE N, the mark -- so it belongs to
 * the same book rather than being a second kind of page.
 *
 * And it keeps the notice. A 3D view with the vertical exaggerated reads as a
 * picture of a floor unless it says it is not one, which is why Diagnostics
 * writes that sentence onto every figure it captures.
 */
import { createRequire } from 'module';
import { mkdir } from 'fs/promises';

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('/tmp/node_modules/puppeteer-core');
}

const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
const FILE = 'rb-diagnostics';
const NOTICE = 'Vertical exaggeration. Visualization is not to scale.';
const results = [];
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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

const canvasId = await page.evaluate(async ({ png, id, notice }) => {
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

  const record = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(record);
  record.firstName = 'Jason';
  record.lastName = 'Mitchell';
  record.propertyAddress = '59 Lodge Trail\nSanta Fe, New Mexico, 87506';
  await window.ToolboxDB.putMedia('plan-dx', png);
  const canvas = record.planSetup.canvases[0];
  canvas.name = 'Main Level';
  canvas.plan = { id: 'plan-dx', width: 1200, height: 800 };

  const boundary = [{ x: 100, y: 100 }, { x: 1100, y: 100 }, { x: 1100, y: 700 }, { x: 100, y: 700 }];
  const points = [];
  for (let i = 1; i <= 9; i += 1) {
    points.push({
      id: 'p' + i, floorId: canvas.id, index: i,
      x: 180 + (i % 3) * 300, y: 180 + Math.floor(i / 3) * 200,
      value: 9.2 - i * 0.3, isBasePoint: i === 1, label: i === 1 ? 'BP1' : String(i),
      createdAt: Date.now(),
    });
  }
  record.floorSurvey.inspectionDate = '2026-10-08';
  record.floorSurvey.byCanvasId[canvas.id] = {
    canvasId: canvas.id, boundary, points,
    areas: [{ id: 'area-dx', name: 'Main', polygon: boundary, createdAt: Date.now() }],
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  await window.ToolboxDB.saveCustomerFile(record);

  // Exactly what Add to Report does in Diagnostics.
  await window.ToolboxDiagnostics.addFigure({
    customerFileId: id,
    dataUrl: png,
    canvasId: canvas.id,
    canvasName: 'Main Level',
    context: {
      levelName: 'Main Level',
      surveyDate: '2026-10-08',
      high: 9.2, low: 6.8, range: 2.4, unit: 'in',
      exaggeration: 12,
      scaleNotice: notice,
    },
  });
  return canvas.id;
}, { png: TINY_PNG, id: FILE, notice: NOTICE });

async function openReport() {
  await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(
    () => document.querySelectorAll('.rb-thumb').length >= 3, { timeout: 25000 });
}
await openReport();

const rail = await page.evaluate(() => [...document.querySelectorAll('.rb-thumb')].map((thumb) => ({
  id: thumb.getAttribute('data-page-id') || '',
  caption: (thumb.querySelector('.rb-thumb__caption')?.textContent || '').trim(),
})));
const dxIndex = rail.findIndex((item) => /^diagnostics-/.test(item.id));
const floorIndex = rail.findIndex((item) => /^floor-/.test(item.id));
check('the captured view is a sheet in the rail, named after its level',
  dxIndex !== -1 && /Diagnostics/.test(rail[dxIndex]?.caption || '') &&
  /Main Level/.test(rail[dxIndex]?.caption || ''),
  rail.map((r) => r.caption).join(' | '));
check('it follows the Floor Survey figure it was drawn from',
  floorIndex !== -1 && dxIndex === floorIndex + 1,
  JSON.stringify({ floorIndex, dxIndex }));

await page.evaluate(() => document.querySelector('.rb-thumb[data-page-id="cover"]')?.click());
await page.waitForFunction(
  () => document.querySelector('.rb-sheet')?.getAttribute('data-page-id') === 'cover',
  { timeout: 15000 });
const contents = await page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
  return [...sheet.querySelectorAll('.rb-cover__contents-item')].map((row) => ({
    num: (row.querySelector('.rb-cover__contents-num')?.textContent || '').trim(),
    title: (row.querySelector('[data-rb-cover-field^="contents:"]')?.textContent || '').trim(),
  }));
});
const dxRow = contents.findIndex((row) => /Diagnostics/.test(row.title));
check('CONTENTS lists it, with a figure number of its own',
  dxRow !== -1 && /^Figure \d+$/.test(contents[dxRow]?.num || ''),
  JSON.stringify(contents));

const dxId = rail[dxIndex].id;
await page.evaluate((id) => document.querySelector(`.rb-thumb[data-page-id="${id}"]`)?.click(), dxId);
await page.waitForFunction(
  (id) => document.querySelector('.rb-sheet')?.getAttribute('data-page-id') === id,
  { timeout: 15000 }, dxId);

const sheet = await page.evaluate(() => {
  const el = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
  const railEl = el.querySelector('.rb-rail__rail');
  const readings = [...(railEl?.querySelectorAll('.rb-rail__readings dd') || [])]
    .map((dd) => dd.textContent.trim());
  return {
    type: el.getAttribute('data-page-type'),
    hasView: !!el.querySelector('.rb-diagnostics-page__view'),
    notice: (el.querySelector('.rb-diagnostics-page__notice')?.textContent || '').trim(),
    hasRail: !!railEl,
    railTitle: (railEl?.querySelector('.rb-rail__title')?.textContent || '').trim(),
    railClient: (railEl?.querySelector('.rb-rail__client')?.textContent || '').trim(),
    railDate: (railEl?.querySelector('.rb-rail__date')?.textContent || '').trim(),
    railFigure: (railEl?.querySelector('.rb-rail__figure')?.textContent || '').trim(),
    readings,
    // Nothing of ours on the paper, the same as every other sheet.
    kicker: !!el.querySelector('.rb-sheet__kicker'),
  };
});
check('the sheet draws the stored view', sheet.type === 'diagnostics' && sheet.hasView,
  JSON.stringify({ type: sheet.type, hasView: sheet.hasView }));
check('and keeps the notice that the vertical is exaggerated',
  sheet.notice.indexOf('Visualization is not to scale') !== -1 &&
  /×12/.test(sheet.notice),
  sheet.notice);
check('it carries the same figure rail as every other sheet',
  sheet.hasRail && /Diagnostics/.test(sheet.railTitle) && /Main Level/.test(sheet.railTitle) &&
  /Mitchell/.test(sheet.railClient) && /2026/.test(sheet.railDate) &&
  /^FIGURE \d+$/.test(sheet.railFigure),
  JSON.stringify(sheet));
check('the rail states the level’s high, low and difference',
  sheet.readings.length === 3 && sheet.readings.every((r) => /in$/.test(r)),
  sheet.readings.join(' · '));
check('no kicker or second title over the rail’s own',
  !sheet.kicker, String(sheet.kicker));

await page.waitForFunction(
  () => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''),
  { timeout: 15000 });
const saved = await page.evaluate(async (id) => {
  const record = await window.ToolboxDB.getCustomerFile(id);
  const pages = record.reportBuilder?.pages || [];
  return {
    types: pages.map((p) => p.type),
    dx: pages.filter((p) => p.type === 'diagnostics').length,
    noEvidenceBlob: pages.every((p) => !p.evidence),
  };
}, FILE);
check('the book saved on the Customer File holds it, without the image',
  saved.dx === 1 && saved.noEvidenceBlob, JSON.stringify(saved));

await openReport();
const reopened = await page.evaluate(() => [...document.querySelectorAll('.rb-thumb')]
  .map((t) => t.getAttribute('data-page-id') || ''));
check('and it is still in its place when the report is reopened',
  reopened.filter((id) => /^diagnostics-/.test(id)).length === 1 &&
  reopened.findIndex((id) => /^diagnostics-/.test(id)) ===
    reopened.findIndex((id) => /^floor-/.test(id)) + 1,
  reopened.join(' | '));

await page.screenshot({ path: `${OUT}/report-diagnostics-page.png` });
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
