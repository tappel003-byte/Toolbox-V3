/**
 * The aerial can be resized, on the cover and on a Floor Survey page.
 *
 * Run: node tests/report-aerial-resizable.mjs   (static server on 8765)
 *
 * The cover aerial's button bar ("Open in Google Maps", "Paste overview") was
 * taken out of the flow so that showing or hiding it could not change the
 * picture's size. Absolute at bottom 0 it then lay across the foot of the
 * box -- over the resize pull in the corner. The pull was drawn, and visible,
 * and could not be grabbed: the bar was what the pointer found. Tim, with the
 * cover open: "I cannot resize the picture."
 *
 * This checks what is actually under the pointer at the pull, and then that
 * dragging it changes the box.
 *
 * The Floor Survey page's aerial is a separate, still-open defect -- see the
 * note at the foot of this file.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'rb-aerial-resize';
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.setViewport({ width: 1700, height: 1050, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

await page.evaluate(async (id) => {
  const img = (() => {
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 900;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 1200, 900);
    x.strokeStyle = '#111'; x.lineWidth = 6; x.strokeRect(30, 30, 1140, 840);
    return c.toDataURL('image/jpeg', 0.9);
  })();
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Aerial'; rec.lastName = 'Resize';
  rec.propertyAddress = '15 Rabbitbrush\nSanta Fe County, NM 87506';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Main Level';
  await window.ToolboxDB.putMedia('plan-ar', img);
  cv.plan = { id: 'plan-ar', width: 1200, height: 900 };
  cv.frontDoorFacing = 'E';
  const poly = [{ x: 40, y: 40 }, { x: 1160, y: 40 }, { x: 1160, y: 860 }, { x: 40, y: 860 }];
  const points = [];
  let n = 0;
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      n += 1;
      points.push({ id: 'p' + n, floorId: cv.id, index: n,
        x: 120 + c * 300, y: 150 + r * 280, value: 7 + ((n * 9) % 27) / 10 });
    }
  }
  rec.floorSurvey = { id: 'fs-ar', inspectionDate: '2026-10-09', byCanvasId: {
    [cv.id]: { canvasId: cv.id, points,
      areas: [{ id: 'a0', name: 'Main Level', polygon: poly, createdAt: 1 }],
      boundary: poly },
  } };
  const aid = 'cover-aerial-ar';
  await window.ToolboxDB.putMedia(aid, img);
  rec.reportBuilder = { coverLayout: { overviewMediaId: aid } };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 7000));

// --- the cover aerial -------------------------------------------------
const coverBox = await page.evaluate(() => {
  const el = document.querySelector('.rb-stage .rb-sheet [data-rb-cover-box="overview"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
check('the cover carries an aerial', !!coverBox, JSON.stringify(coverBox));
await page.mouse.move(coverBox.x, coverBox.y);
await page.mouse.down();
await page.mouse.up();
await new Promise((r) => setTimeout(r, 600));

const pull = await page.evaluate(() => {
  const el = document.querySelector('.rb-stage .rb-sheet [data-rb-cover-box="overview"]');
  const h = el.querySelector('.rb-cover-box__resize');
  const r = h.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const hit = document.elementFromPoint(cx, cy);
  return {
    shown: getComputedStyle(h).display !== 'none',
    x: cx, y: cy,
    hitIsHandle: hit === h || (hit && h.contains(hit)),
    hitClass: hit ? String(hit.className || hit.tagName).slice(0, 40) : null,
  };
});
check('selecting it shows the resize pull', pull.shown, JSON.stringify(pull));
check('and the pull is what the pointer finds, not the button bar',
  pull.hitIsHandle, pull.hitClass || '');

const before = await page.evaluate(() => {
  const el = document.querySelector('.rb-stage .rb-sheet [data-rb-cover-box="overview"]');
  const r = el.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height) };
});
await page.mouse.move(pull.x, pull.y);
await page.mouse.down();
await page.mouse.move(pull.x + 90, pull.y + 60, { steps: 12 });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 1200));
const after = await page.evaluate(() => {
  const el = document.querySelector('.rb-stage .rb-sheet [data-rb-cover-box="overview"]');
  const r = el.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height) };
});
check('dragging the pull resizes the cover aerial',
  after.w > before.w + 20 && after.h > before.h + 10,
  JSON.stringify({ before, after }));

// The Floor Survey page's aerial is NOT covered here. Its pull is drawn and
// is what the pointer finds, but the drag does nothing: the live drawing's
// canvas holds the pointer capture by the time the move arrives
// (canvas.hasPointerCapture(1) === true, the box's is false), so every
// pointermove is retargeted to the canvas and the floor drag never sees one.
// That is its own defect and gets its own fix and its own test.

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
