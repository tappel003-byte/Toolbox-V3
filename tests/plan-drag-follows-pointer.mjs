/**
 * The plan follows the pointer, whatever the page is drawn at.
 *
 * Run: node tests/plan-drag-follows-pointer.mjs   (static server on 8765)
 *
 * PlanCanvas put SCREEN pointer deltas straight into its own transform,
 * which is in the element's own pixels. Those are the same thing in the
 * field, where nothing scales the host. On a Report Builder sheet they are
 * not: the sheet is a fixed 1632 x 1056 drawn at whatever fits, so a 100 px
 * drag moved the plan 100 of ITS pixels and showed up as about 75 px on
 * screen. The plan lagged the pointer. Once the stage gained a zoom control
 * it could also run AHEAD of it, above 100%. Audit finding 5.
 *
 * The scale is measured inside the component rather than handed to it,
 * so in unscaled field use it is exactly 1 and every expression reduces to
 * what it was. That is asserted here, not assumed: the field path is driven
 * through the same gesture and must move pixel for pixel.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'rb-plan-drag';
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
const p = await browser.newPage();
p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await p.setViewport({ width: 1640, height: 1000, deviceScaleFactor: 1 });
await p.goto(BASE, { waitUntil: 'networkidle0' });

await p.evaluate(async (id) => {
  const plan = (() => {
    const c = document.createElement('canvas'); c.width = 1200; c.height = 900;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 1200, 900);
    x.strokeStyle = '#111'; x.lineWidth = 6; x.strokeRect(30, 30, 1140, 840);
    return c.toDataURL('image/jpeg', 0.9);
  })();
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Drag'; rec.lastName = 'Probe';
  rec.propertyAddress = '15 Rabbitbrush\nSanta Fe County, NM 87506';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Main Level';
  await window.ToolboxDB.putMedia('plan-pd', plan);
  cv.plan = { id: 'plan-pd', width: 1200, height: 900 };
  cv.frontDoorFacing = 'E';
  const poly = [{ x: 40, y: 40 }, { x: 1160, y: 40 },
    { x: 1160, y: 860 }, { x: 40, y: 860 }];
  const points = []; let n = 0;
  for (let r = 0; r < 3; r += 1) for (let c = 0; c < 4; c += 1) {
    n += 1;
    points.push({ id: 'p' + n, floorId: cv.id, index: n,
      x: 120 + c * 300, y: 150 + r * 280, value: 7 + ((n * 9) % 27) / 10 });
  }
  rec.floorSurvey = { id: 'fs-pd', inspectionDate: '2026-10-09', byCanvasId: {
    [cv.id]: { canvasId: cv.id, points,
      areas: [{ id: 'a0', name: 'Main Level', polygon: poly, createdAt: 1 }],
      boundary: poly },
  } };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await p.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await p.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 8000));
await p.evaluate(() => {
  const t = [...document.querySelectorAll('.rb-thumb[data-page-id]')]
    .find((x) => /floor|main level/i.test(x.getAttribute('aria-label') || ''));
  if (t) t.click();
});
await new Promise((r) => setTimeout(r, 5000));

const viewport = () => p.evaluate(() => {
  const el = document.querySelector('.rb-stage [data-floor-viewport]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const sheet = el.closest('.rb-sheet');
  return {
    tx: Number(el.getAttribute('data-canvas-tx')),
    ty: Number(el.getAttribute('data-canvas-ty')),
    scale: Number(el.getAttribute('data-canvas-scale')),
    // What the host is drawing this element at.
    hostScale: +(r.width / el.offsetWidth).toFixed(6),
    cx: r.left + r.width / 2, cy: r.top + r.height / 2,
    sheetScale: sheet ? +(sheet.getBoundingClientRect().height / sheet.clientHeight).toFixed(6) : null,
  };
});

// Driven with the real mouse, not synthetic events: PlanCanvas takes a
// pointer capture, and a dispatched PointerEvent has no active pointer for
// the browser to capture, so the handler throws before it ever pans.
async function dragBy(dxScreen, dyScreen) {
  const v = await viewport();
  await p.mouse.move(v.cx, v.cy);
  await p.mouse.down();
  for (let i = 1; i <= 10; i += 1) {
    await p.mouse.move(v.cx + (dxScreen * i) / 10, v.cy + (dyScreen * i) / 10);
  }
  await p.mouse.up();
  await new Promise((r) => setTimeout(r, 700));
  const after = await viewport();
  return { before: v, after };
}

const start = await viewport();
check('the live drawing is on the sheet', !!start && isFinite(start.tx),
  JSON.stringify(start));
check('and the sheet really is drawn smaller than its own pixels',
  start.hostScale > 0.3 && start.hostScale < 0.95,
  `hostScale ${start.hostScale}`);

const fitDrag = await dragBy(120, 0);
const movedOwn = fitDrag.after.tx - fitDrag.before.tx;
const movedScreen = movedOwn * fitDrag.before.hostScale;
check('a 120 px drag moves the plan 120 px ON SCREEN, not 120 of its own',
  Math.abs(movedScreen - 120) < 8,
  `own ${movedOwn.toFixed(1)}px → screen ${movedScreen.toFixed(1)}px at scale ${fitDrag.before.hostScale}`);

// Zoom past 100%, where the old arithmetic ran AHEAD of the pointer.
await p.click('#rb-zoom-in'); await p.click('#rb-zoom-in');
await p.click('#rb-zoom-in'); await p.click('#rb-zoom-in');
await new Promise((r) => setTimeout(r, 1500));
const big = await viewport();
check('zoomed past 100%, the sheet is drawn larger than its own pixels',
  big.hostScale > 1.05, `hostScale ${big.hostScale}`);

const zoomDrag = await dragBy(120, 0);
const movedOwn2 = zoomDrag.after.tx - zoomDrag.before.tx;
const movedScreen2 = movedOwn2 * zoomDrag.before.hostScale;
check('and a 120 px drag still moves it 120 px on screen',
  Math.abs(movedScreen2 - 120) < 8,
  `own ${movedOwn2.toFixed(1)}px → screen ${movedScreen2.toFixed(1)}px at scale ${zoomDrag.before.hostScale}`);
check('the plan does not run ahead of the pointer when zoomed in',
  Math.abs(movedOwn2) < Math.abs(movedOwn) + 1,
  `own at fit ${movedOwn.toFixed(1)} vs own zoomed ${movedOwn2.toFixed(1)}`);

await p.click('#rb-zoom-level');
await new Promise((r) => setTimeout(r, 1200));

// ------------------------------------------------- the unscaled field path
await p.goto(`${BASE}#/file/${FILE}/floor`, { waitUntil: 'networkidle0' });
await p.waitForFunction(() => !!document.querySelector('[data-floor-viewport]'),
  { timeout: 40000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 6000));

const field = await p.evaluate(() => {
  const el = document.querySelector('[data-floor-viewport]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { hostScale: +(r.width / el.offsetWidth).toFixed(6),
    tx: Number(el.getAttribute('data-canvas-tx')),
    cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
});

if (!field) {
  check('the field drawing opened', false, 'no viewport on the Floor Survey route');
} else {
  check('nothing scales the drawing in the field — hostScale is exactly 1',
    field.hostScale === 1, String(field.hostScale));
  await p.mouse.move(field.cx, field.cy);
  await p.mouse.down();
  for (let i = 1; i <= 10; i += 1) await p.mouse.move(field.cx + (120 * i) / 10, field.cy);
  await p.mouse.up();
  await new Promise((r) => setTimeout(r, 700));
  const afterField = await p.evaluate(() => {
    const el = document.querySelector('[data-floor-viewport]');
    return Number(el.getAttribute('data-canvas-tx'));
  });
  check('and a 120 px field drag moves it 120 px, pixel for pixel',
    Math.abs((afterField - field.tx) - 120) < 4,
    `${(afterField - field.tx).toFixed(1)}px`);
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
