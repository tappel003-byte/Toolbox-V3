/**
 * Every placement a report carries can be made the default for the next one.
 * Run: node tests/report-template.mjs   (needs a static server on 8765)
 *
 * Tim: "that's fine it becomes the default, but everything is eligible,
 * right -- that's the whole point of this." VISION and DECISIONS already
 * settle that the stable pieces stay template-friendly; what this holds down
 * is that every rail which places something offers the same button, that it
 * keeps that piece and nothing else, and that a report already written is
 * never moved by a default set afterwards.
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
const FILE = 'rb-template';
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

await page.evaluate(async ({ png, id }) => {
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
  await window.ToolboxDB.putMedia('plan-chrome', png);
  const canvas = record.planSetup.canvases[0];
  canvas.name = 'Main Level';
  canvas.plan = { id: 'plan-chrome', width: 1200, height: 800 };
  const canvasId = canvas.id;

  // A boundary with readings, so the floor sheet has something to import.
  const boundary = [{ x: 120, y: 120 }, { x: 1080, y: 120 }, { x: 1080, y: 680 }, { x: 120, y: 680 }];
  const points = [];
  let n = 0;
  for (let gx = 0; gx < 5; gx += 1) {
    for (let gy = 0; gy < 3; gy += 1) {
      n += 1;
      points.push({
        id: 'p' + n, floorId: canvasId, index: n,
        x: 200 + gx * 190, y: 200 + gy * 180,
        value: 9.2 - gx * 0.4 - gy * 0.3,
        isBasePoint: n === 1, label: n === 1 ? 'BP1' : String(n),
        createdAt: Date.now(),
      });
    }
  }
  record.floorSurvey.inspectionDate = '2026-10-08';
  record.floorSurvey.byCanvasId[canvasId] = {
    canvasId, boundary, points,
    areas: [{ id: 'area-main', name: 'Main', polygon: boundary, createdAt: Date.now() }],
    createdAt: Date.now(), updatedAt: Date.now(),
  };

  // Pins, so there is a Picture Locations sheet and a Pictures sheet.
  const pins = [];
  for (let i = 1; i <= 4; i += 1) {
    const photoId = 'ph-chrome-' + i;
    await window.ToolboxDB.putMedia(photoId, png);
    pins.push({
      id: 'pin-' + i, num: i, canvasId,
      x: 0.2 + i * 0.12, y: 0.3 + (i % 3) * 0.15,
      location: 'Room ' + i, description: 'Observation ' + i,
      photos: [{ id: photoId }],
    });
  }
  record.distress = {
    mode: 'internal', startNum: 1, nextNum: pins.length + 1, activeCanvasId: canvasId, pins,
  };
  await window.ToolboxDB.saveCustomerFile(record);
}, { png: TINY_PNG, id: FILE });


// Nothing kept from an earlier run: a default already on the shelf would make
// every check below pass for the wrong reason.
await page.evaluate(() => {
  try { localStorage.removeItem('toolbox-report-template'); } catch { /* no store */ }
});
await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => document.querySelectorAll('.rb-thumb').length >= 4, { timeout: 25000 });

async function openSlide(pattern) {
  const id = await page.evaluate((re) => {
    const thumb = [...document.querySelectorAll('.rb-thumb')]
      .find((t) => new RegExp(re).test(t.getAttribute('data-page-id') || ''));
    if (!thumb) return '';
    thumb.click();
    return thumb.getAttribute('data-page-id') || '';
  }, pattern);
  if (!id) return '';
  await page.waitForFunction(
    (want) => document.querySelector('.rb-sheet')?.getAttribute('data-page-id') === want,
    { timeout: 15000 }, id);
  await new Promise((r) => setTimeout(r, 900));
  return id;
}
function template() {
  return page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('toolbox-report-template') || '{}'); }
    catch { return {}; }
  });
}
async function pressDefault(which) {
  await page.evaluate((w) => {
    document.querySelector(`[data-rb-template="${w}"]`)?.click();
  }, which);
  await new Promise((r) => setTimeout(r, 600));
}

// --- the title page ----------------------------------------------------
await openSlide('^cover$');
const coverOffer = await page.evaluate(() => ({
  offered: !!document.querySelector('.rb-panel [data-rb-template="cover"]'),
  onSheet: !!document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-template]'),
}));
check('the title page offers it, in the rail rather than on the paper',
  coverOffer.offered && !coverOffer.onSheet, JSON.stringify(coverOffer));
await pressDefault('cover');
const afterCover = await template();
check('and it keeps the cover boxes and nothing else',
  !!afterCover.coverLayout && Object.keys(afterCover).length === 1,
  Object.keys(afterCover).join(','));

// --- the discussion ----------------------------------------------------
await openSlide('^section-discussion$');
check('the discussion offers it too',
  await page.evaluate(() => !!document.querySelector('.rb-panel [data-rb-template="discussion"]')), '');
await pressDefault('discussion');
const afterDisc = await template();
check('and it keeps the writing area',
  !!afterDisc.discussionBox && !!afterDisc.coverLayout,
  Object.keys(afterDisc).join(','));

// --- a Floor Survey figure ---------------------------------------------
const floorId = await openSlide('^floor-');
if (floorId) {
  const imported = await page.evaluate(() => {
    const btn = document.querySelector('[data-rb-floor-import]');
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (imported) await new Promise((r) => setTimeout(r, 4000));
  check('a Floor Survey figure offers it',
    await page.evaluate(() => !!document.querySelector('.rb-panel [data-rb-template="floor"]')), '');
  await pressDefault('floor');
  const afterFloor = await template();
  check('and it keeps how the building is framed and what is drawn in it',
    !!afterFloor.floorLayout && !!afterFloor.floorCamera,
    Object.keys(afterFloor).join(','));
}

// --- a Picture Locations sheet -----------------------------------------
const penId = await openSlide('^distress-');
if (penId) {
  check('a Picture Locations sheet offers it',
    await page.evaluate(() => !!document.querySelector('[data-rb-template="penlog"]')), '');
  await pressDefault('penlog');
  const afterPen = await template();
  check('and it keeps whether the contour layer is drawn under the pins',
    typeof afterPen.penLogContour === 'boolean', JSON.stringify(afterPen.penLogContour));
}

// --- a fresh job starts from all of it ---------------------------------
const kept = await template();
const SECOND = `${FILE}-next`;
await page.evaluate(async (id) => {
  const record = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(record);
  record.firstName = 'Nora';
  record.lastName = 'Vance';
  record.propertyAddress = '1 Fresh Street';
  await window.ToolboxDB.saveCustomerFile(record);
}, SECOND);
await page.goto(`${BASE}#/file/${SECOND}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => document.querySelector('.rb-thumb[data-page-id="section-discussion"]'), { timeout: 25000 });
await page.waitForFunction(
  () => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''), { timeout: 20000 });
const freshDoc = await page.evaluate(async (id) => {
  const record = await window.ToolboxDB.getCustomerFile(id);
  const doc = record.reportBuilder || {};
  return {
    coverLayout: !!doc.coverLayout,
    discussionBox: doc.discussionBox || null,
    floorLayout: !!doc.floorLayout,
  };
}, SECOND);
check('a job that has never been placed opens with every one of them',
  freshDoc.coverLayout && freshDoc.floorLayout && !!freshDoc.discussionBox &&
  Math.abs(freshDoc.discussionBox.w - kept.discussionBox.w) < 0.5,
  JSON.stringify(freshDoc));

// --- and a report already written is left alone ------------------------
await page.evaluate(() => {
  try {
    localStorage.setItem('toolbox-report-template',
      JSON.stringify({ discussionBox: { x: 40, y: 40, w: 40, h: 40 } }));
  } catch { /* no store */ }
});
await page.goto(`${BASE}#/file/${SECOND}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => document.querySelector('.rb-thumb[data-page-id="section-discussion"]'), { timeout: 25000 });
const reopened = await page.evaluate(async (id) => {
  const record = await window.ToolboxDB.getCustomerFile(id);
  return (record.reportBuilder || {}).discussionBox || null;
}, SECOND);
check('a report already placed is not moved by a default set afterwards',
  !!reopened && Math.abs(reopened.w - kept.discussionBox.w) < 0.5,
  JSON.stringify({ reopened, kept: kept.discussionBox }));

await page.screenshot({ path: `${OUT}/report-template.png` });
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
