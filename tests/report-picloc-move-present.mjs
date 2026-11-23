/**
 * Picture Locations: body-drag moves (never shrinks); Crop fills the frame;
 * Present works with whole-level Floor Survey (Tim, Nov 23, 2026).
 *
 * Run: node tests/report-picloc-move-present.mjs  (static server on 8765)
 */
import { createRequire } from 'module';
import { mkdir } from 'fs/promises';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'rb-picloc-move-present';
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
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

// Unit: placeBoxOnSheet preserves size at the sheet edge
const unit = await page.evaluate(() => {
  const api = window.ToolboxPenLog;
  const wide = api.placeBoxOnSheet({ x: 10, y: 0.5, w: 12, h: 9, z: 1 }, api.LAYOUT.plan);
  return {
    w: wide.w,
    h: wide.h,
    x: wide.x,
    preserved: Math.abs(wide.w - 12) < 0.01 && Math.abs(wide.h - 9) < 0.01,
    onSheet: wide.x + wide.w <= 17.001 && wide.x >= 0,
  };
});
check('placeBoxOnSheet keeps w/h when parked at the right edge',
  unit.preserved && unit.onSheet, JSON.stringify(unit));

await page.evaluate(async (id) => {
  const img = (() => {
    const c = document.createElement('canvas');
    c.width = 1600; c.height = 1000;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 1600, 1000);
    x.fillStyle = '#1a1a1a';
    x.fillRect(480, 220, 640, 560);
    x.fillStyle = '#f5f5f5'; x.fillRect(500, 240, 600, 520);
    x.strokeStyle = '#111'; x.lineWidth = 6; x.strokeRect(500, 240, 600, 520);
    return c.toDataURL('image/jpeg', 0.92);
  })();
  await ToolboxDB.putMedia('plan-move-present', img);
  const rec = ToolboxApp.blankCustomerFile(id);
  ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Ryan'; rec.lastName = 'Haddow';
  rec.propertyAddress = '8511 Calle Norte Trail\nFarmington, NM 87402';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Main Floor';
  cv.plan = { id: 'plan-move-present', width: 1600, height: 1000 };
  rec.reportBuilder = {
    schema: 'toolbox.report-builder',
    schemaVersion: 1,
    penLogLayout: {
      plan: { x: 0.4, y: 0.45, w: 12.5, h: 10.1, z: 1 },
      schedule: { x: 13.2, y: 0.45, w: 1.5, h: 4, z: 2 },
    },
  };
  const pins = [];
  for (let i = 0; i < 6; i++) {
    pins.push({
      id: 'pin-' + i, canvasId: cv.id,
      x: 0.4 + (i % 3) * 0.1, y: 0.4 + Math.floor(i / 3) * 0.12,
      description: 'note ' + i, photos: ['ph-' + i],
    });
  }
  rec.distress = { updatedAt: new Date().toISOString(), activeCanvasId: cv.id, pins };
  rec.floorSurvey = {
    id: 'fs-move-present', inspectionDate: '2025-11-21', byCanvasId: {
      [cv.id]: {
        canvasId: cv.id,
        points: [
          { id: 'a', x: 600, y: 400, value: 0 },
          { id: 'b', x: 900, y: 700, value: -1 },
          { id: 'c', x: 750, y: 500, value: 0.5 },
        ],
        areas: [],
        boundary: [{ x: 500, y: 200 }, { x: 1200, y: 200 }, { x: 1200, y: 800 }, { x: 500, y: 800 }],
      },
    },
  };
  await ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => document.querySelector('.rb-shell')?.getAttribute('data-report-ready') === 'true',
  { timeout: 90000 },
);
await new Promise((r) => setTimeout(r, 2000));

await page.evaluate(() => {
  const t = [...document.querySelectorAll('.rb-thumb')].find((el) =>
    (el.querySelector('.rb-thumb__caption')?.textContent || '').includes('Picture'));
  if (t) t.click();
});
await new Promise((r) => setTimeout(r, 1000));

async function measure() {
  return page.evaluate(() => {
    const box = document.querySelector('.rb-stage .rb-penlog__plan');
    const fit = document.querySelector('.rb-stage .rb-penlog__fit');
    const sheet = document.querySelector('.rb-stage .rb-sheet:not(.rb-sheet--thumb)');
    if (!box || !fit || !sheet) return null;
    const br = box.getBoundingClientRect();
    const fr = fit.getBoundingClientRect();
    const sr = sheet.getBoundingClientRect();
    return {
      boxW: br.width / sr.width * 17,
      boxH: br.height / sr.height * 11,
      boxX: (br.left - sr.left) / sr.width * 17,
      fitW: fr.width / sr.width * 17,
      gapLeft: (fr.left - br.left) / sr.width * 17,
      gapRight: (br.right - fr.right) / sr.width * 17,
      zoom: Number(box.getAttribute('data-rb-camera-zoom') || 1),
      cropped: box.classList.contains('is-cropped'),
      styleW: box.style.width,
      styleLeft: box.style.left,
    };
  });
}

const before = await measure();

// Crop
await page.evaluate(async () => {
  const plan = document.querySelector('.rb-stage .rb-penlog__plan');
  plan.focus();
  plan.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 500, clientY: 400, button: 2 }));
  await new Promise((r) => setTimeout(r, 250));
  const crop = [...document.querySelectorAll('button, [role="menuitem"], *')]
    .find((el) => el.childNodes.length && /^Crop$/i.test((el.textContent || '').trim()));
  if (crop) crop.click();
});
await new Promise((r) => setTimeout(r, 1500));
const afterCrop = await measure();
check('Crop raises zoom and marks the plan cropped',
  afterCrop && afterCrop.cropped && afterCrop.zoom > 1.05,
  JSON.stringify(afterCrop));
check('After Crop, no empty band on the left inside the plan box',
  afterCrop && afterCrop.gapLeft > -0.05 && afterCrop.gapLeft < 0.25,
  JSON.stringify({ gapLeft: afterCrop?.gapLeft, gapRight: afterCrop?.gapRight, boxW: afterCrop?.boxW, boxH: afterCrop?.boxH }));
check('After Crop, the plan box tightens toward the drawing aspect',
  before && afterCrop && afterCrop.boxH < before.boxH - 0.3,
  JSON.stringify({ beforeH: before?.boxH, afterH: afterCrop?.boxH, beforeW: before?.boxW, afterW: afterCrop?.boxW }));

// Body-drag right until the sheet edge — width must not shrink
const drag = await page.evaluate(async () => {
  const box = document.querySelector('.rb-stage .rb-penlog__plan');
  const sheet = document.querySelector('.rb-stage .rb-sheet:not(.rb-sheet--thumb)');
  const sr = sheet.getBoundingClientRect();
  const perInX = sr.width / 17;
  const w0 = box.style.width;
  const br = box.getBoundingClientRect();
  const cx = br.left + br.width * 0.5;
  const cy = br.top + br.height * 0.5;
  function fire(type, x, y) {
    box.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, clientX: x, clientY: y,
      pointerId: 1, pointerType: 'mouse', buttons: type === 'pointerup' ? 0 : 1,
    }));
  }
  fire('pointerdown', cx, cy);
  fire('pointermove', cx + perInX * 8, cy);
  fire('pointerup', cx + perInX * 8, cy);
  await new Promise((r) => setTimeout(r, 200));
  return {
    w0,
    w1: box.style.width,
    left: box.style.left,
    sameWidth: box.style.width === w0,
  };
});
check('Body-drag toward the right edge does not shrink the plan box',
  drag.sameWidth, JSON.stringify(drag));

// Drag left — can reduce x
const dragLeft = await page.evaluate(async () => {
  const box = document.querySelector('.rb-stage .rb-penlog__plan');
  const sheet = document.querySelector('.rb-stage .rb-sheet:not(.rb-sheet--thumb)');
  const sr = sheet.getBoundingClientRect();
  const perInX = sr.width / 17;
  const left0 = parseFloat(box.style.left) || 0;
  const br = box.getBoundingClientRect();
  const cx = br.left + br.width * 0.5;
  const cy = br.top + br.height * 0.5;
  function fire(type, x, y) {
    box.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, clientX: x, clientY: y,
      pointerId: 1, pointerType: 'mouse', buttons: type === 'pointerup' ? 0 : 1,
    }));
  }
  fire('pointerdown', cx, cy);
  fire('pointermove', cx - perInX * 4, cy);
  fire('pointerup', cx - perInX * 4, cy);
  await new Promise((r) => setTimeout(r, 200));
  const left1 = parseFloat(box.style.left) || 0;
  return { left0, left1, movedLeft: left1 < left0 - 0.5, w: box.style.width };
});
check('Body-drag left moves the plan into empty sheet space',
  dragLeft.movedLeft, JSON.stringify(dragLeft));

// Present
const present = await page.evaluate(async () => {
  const btn = document.querySelector('#rb-present');
  btn.click();
  await new Promise((r) => setTimeout(r, 10000));
  const presenting = document.body.classList.contains('is-presenting');
  const deck = !!document.querySelector('.rb-print--present');
  const blocked = (document.body.innerText || '').includes('Present blocked');
  if (presenting) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }
  return { presenting, deck, blocked };
});
check('Presentation view opens',
  present.presenting && present.deck && !present.blocked,
  JSON.stringify(present));

check('No page errors', pageErrors.length === 0, pageErrors.join(' | '));
check('Baseline before crop had a wide tall plan box',
  before && before.boxW > 10 && before.boxH > 8,
  JSON.stringify(before));

await page.screenshot({ path: `${OUT}/rb-picloc-move-present.png` }).catch(() => {});
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
