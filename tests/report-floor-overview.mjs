/**
 * The site overview on a Floor Survey page.
 * Run: node tests/report-floor-overview.mjs   (needs a static server on 8765)
 *
 * Settled Tim, Oct 10, 2026: "once you put it in on the cover page it should
 * automatically go in there, and then if it's not right you just delete it."
 * So the aerial view is put on the cover once and every Floor Survey figure
 * carries it, with nothing to add and nothing to choose. Tim, Oct 16, on what
 * it needs beyond that: "able to delete on FS pages if too cluttered (user
 * defined) and moveable by user."
 *
 * What this guards: that the cover's picture reaches the figure page by
 * itself, that it can be moved and that where it was put is saved, and that
 * the x takes it off that page alone -- not off the cover, and not off the
 * other Floor Survey pages.
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
const FILE = 'rb-floor-overview';
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
  record.firstName = 'Ada';
  record.lastName = 'Mireles';
  record.propertyAddress = '7 Overview Way\nSanta Fe, NM 87505';
  const canvasId = record.planSetup.canvases[0].id;
  await window.ToolboxDB.putMedia('plan-overview', png);
  record.planSetup.canvases[0].plan = { id: 'plan-overview', width: 400, height: 300 };
  record.planSetup.canvases[0].frontDoorFacing = 'N';
  const poly = [
    { x: 40, y: 40 }, { x: 360, y: 40 }, { x: 360, y: 260 }, { x: 40, y: 260 },
  ];
  record.floorSurvey = {
    id: 'fs-overview',
    inspectionDate: '2026-10-01',
    byCanvasId: {
      [canvasId]: {
        canvasId,
        points: [
          { id: 'p1', floorId: canvasId, x: 80, y: 80, value: 5.5, index: 1 },
          { id: 'p2', floorId: canvasId, x: 200, y: 100, value: 10.0, index: 2 },
          { id: 'p3', floorId: canvasId, x: 120, y: 180, value: 7.2, index: 3 },
          { id: 'p4', floorId: canvasId, x: 300, y: 150, value: 8.1, index: 4 },
        ],
        areas: [{ id: 'a1', name: 'Main', polygon: poly, createdAt: 1 }],
        boundary: poly,
      },
    },
  };
  await window.ToolboxDB.saveCustomerFile(record);
}, { png: TINY_PNG, id: FILE });

// Open the book once so it writes itself onto the Customer File, then put the
// aerial view on the cover the way the paste button does -- with the book
// closed, because an open book saves its own copy back over anything changed
// underneath it.
await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelector('.rb-thumb[data-page-id^="floor-"]'), { timeout: 20000 });
await page.waitForFunction(
  () => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''), { timeout: 15000 });
await page.goto(`${BASE}#/file/${FILE}`, { waitUntil: 'networkidle0' });
await page.evaluate(async ({ png, id }) => {
  await window.ToolboxDB.putMedia('overview-media', png);
  const record = await window.ToolboxDB.getCustomerFile(id);
  record.reportBuilder.coverLayout = Object.assign({}, record.reportBuilder.coverLayout || {}, {
    overviewMediaId: 'overview-media',
  });
  await window.ToolboxDB.saveCustomerFile(record);
}, { png: TINY_PNG, id: FILE });

async function openFloorSheet() {
  await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector('.rb-thumb[data-page-id^="floor-"]'), { timeout: 20000 });
  await page.evaluate(() => document.querySelector('.rb-thumb[data-page-id^="floor-"]').click());
  await page.waitForFunction(
    () => document.querySelector('[data-rb-floor-import]') ||
      document.querySelector('[data-rb-floor-box^="topo"]'),
    { timeout: 20000 });
  if (await page.$('[data-rb-floor-import]')) {
    await page.click('[data-rb-floor-import]');
    await page.waitForFunction(() => !!document.querySelector('[data-rb-floor-box^="topo"]'), { timeout: 25000 });
  }
}

const overviewNow = () => page.evaluate(() => {
  const box = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-box="overview"]');
  if (!box) return null;
  const image = box.querySelector('.rb-floor-overview__image');
  const rect = box.getBoundingClientRect();
  return {
    src: (image && image.getAttribute('src') || '').slice(0, 11),
    removable: !!box.querySelector('[data-rb-floor-overview]'),
    left: Math.round(rect.x),
    top: Math.round(rect.y),
    width: Math.round(rect.width),
  };
});

await openFloorSheet();
const placed = await overviewNow();
check('the cover’s aerial view reaches the Floor Survey page by itself',
  !!placed && placed.src === 'data:image/' && placed.width > 0, JSON.stringify(placed));
check('and it carries the x that takes it off this page', !!placed && placed.removable,
  JSON.stringify(placed));

// Moved by dragging it, like every other box on the sheet.
const moved = await page.evaluate(async () => {
  const box = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-box="overview"]');
  const rect = box.getBoundingClientRect();
  const from = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const send = (type, x, y) => box.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse',
  }));
  send('pointerdown', from.x, from.y);
  send('pointermove', from.x + 160, from.y - 90);
  send('pointerup', from.x + 160, from.y - 90);
  return { x: rect.x, y: rect.y };
});
await page.waitForFunction(
  () => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''), { timeout: 15000 });
const after = await overviewNow();
check('it moves where it is dragged',
  !!after && after.left > moved.x + 100 && after.top < moved.y - 50,
  JSON.stringify({ moved, after }));

await openFloorSheet();
const reopened = await overviewNow();
check('and stays where it was put',
  !!reopened && Math.abs(reopened.left - after.left) < 4 && Math.abs(reopened.top - after.top) < 4,
  JSON.stringify({ after, reopened }));

// The x. Off this page, and off nothing else.
await page.evaluate(() => document.querySelector(
  '.rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-overview]').click());
await page.waitForFunction(
  () => !document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-box="overview"]'),
  { timeout: 15000 });
await page.waitForFunction(
  () => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''), { timeout: 15000 });

const stored = await page.evaluate(async (id) => {
  const record = await window.ToolboxDB.getCustomerFile(id);
  const pages = record.reportBuilder?.pages || [];
  const floor = pages.find((p) => p.type === 'floor');
  return {
    hidden: !!(floor?.meta && floor.meta.hideOverview),
    coverStillHasIt: (record.reportBuilder?.coverLayout || {}).overviewMediaId || '',
    // One layout record for the whole report (DECIDED Tim, Oct 22, 2026):
    // the aerial's place is the book's, not a copy on the slide.
    savedX: record.reportBuilder?.floorLayout?.overview?.x ?? null,
  };
}, FILE);
check('the x takes it off this page and leaves the cover alone',
  stored.hidden && stored.coverStillHasIt === 'overview-media', JSON.stringify(stored));
check('where it was moved to is on the Customer File',
  typeof stored.savedX === 'number' && stored.savedX > 2, JSON.stringify(stored));

await openFloorSheet();
check('and it is still gone after coming back', (await overviewNow()) === null);

// The cover is untouched: its own overview is still on it.
await page.evaluate(() => document.querySelector('.rb-thumb[data-page-id="cover"]')?.click());
await page.waitForFunction(() => document.querySelector('.rb-sheet .rb-cover-box--overview'), { timeout: 15000 });
const coverImage = await page.evaluate(() => !!document.querySelector(
  '.rb-sheet:not(.rb-sheet--thumb) .rb-cover__overview-image'));
check('the cover still shows its own overview', coverImage);

await page.screenshot({ path: `${OUT}/report-floor-overview.png` });
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
