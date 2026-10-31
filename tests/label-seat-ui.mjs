/**
 * Control panel → Readings → Show → label seat (side×height / Center).
 *
 * Run: node tests/label-seat-ui.mjs  (static server on 8765)
 */
import { createRequire } from 'module';
import { mkdir } from 'fs/promises';
const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
const FILE = 'label-seat-ui';
await mkdir(OUT, { recursive: true });
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
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

await page.evaluate(async (id) => {
  const c = document.createElement('canvas');
  c.width = 800; c.height = 600;
  const x = c.getContext('2d');
  x.fillStyle = '#f0ebe0'; x.fillRect(0, 0, 800, 600);
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Seat'; rec.lastName = 'UI';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Main Level';
  await window.ToolboxDB.putMedia('plan-seat', c.toDataURL('image/png'));
  cv.plan = { id: 'plan-seat', width: 800, height: 600 };
  rec.floorSurvey = {
    id: 'fs-' + id,
    inspectionDate: '2026-10-30',
    byCanvasId: {
      [cv.id]: {
        canvasId: cv.id,
        inspectionDate: '2026-10-30',
        points: [
          { id: 'hi', floorId: cv.id, index: 1, x: 500, y: 180, value: 3.3 },
          { id: 'lo', floorId: cv.id, index: 2, x: 200, y: 420, value: 1.1 },
          { id: 'mid', floorId: cv.id, index: 3, x: 350, y: 300, value: 2.2 },
        ],
        areas: [{
          id: 'a0', name: 'Main',
          polygon: [{ x: 60, y: 60 }, { x: 740, y: 60 }, { x: 740, y: 540 }, { x: 60, y: 540 }],
          createdAt: 1,
        }],
        transitions: [],
        transitionGroupAverages: {},
      },
    },
  };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/floor`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 2500));
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => /Topo/.test(b.textContent || ''))?.click();
});
await new Promise((r) => setTimeout(r, 2000));

await page.evaluate(() => {
  document.querySelector('[aria-label="Control panel"]')?.click();
});
await new Promise((r) => setTimeout(r, 600));
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Readings')?.click();
});
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Show')?.click();
});
await new Promise((r) => setTimeout(r, 400));

const seatUi = await page.evaluate(() => {
  const sides = document.querySelector('[aria-label="Point label side"]');
  const heights = document.querySelector('[aria-label="Point label seat"]');
  if (!sides || !heights) return null;
  const sideLabels = [...sides.querySelectorAll('button')].map((b) => (b.textContent || '').trim());
  const heightLabels = [...heights.querySelectorAll('button')].map((b) => (b.textContent || '').trim());
  const pressed = [...sides.querySelectorAll('button'), ...heights.querySelectorAll('button')]
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => (b.textContent || '').trim());
  return { sideLabels, heightLabels, pressed };
});
check(
  'Show has Left/Right and Top/Middle/Bottom/Center',
  !!seatUi &&
    seatUi.sideLabels.join(',') === 'Left,Right' &&
    seatUi.heightLabels.join(',') === 'Top,Middle,Bottom,Center',
  JSON.stringify(seatUi),
);
check(
  'Default highlights Right and Bottom',
  !!seatUi && seatUi.pressed.join(',') === 'Right,Bottom',
  JSON.stringify(seatUi?.pressed),
);

await page.evaluate(() => {
  const sides = document.querySelector('[aria-label="Point label side"]');
  [...(sides?.querySelectorAll('button') || [])]
    .find((b) => (b.textContent || '').trim() === 'Left')
    ?.click();
});
await new Promise((r) => setTimeout(r, 500));

const afterLeft = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const layer = Object.values(rec.floorSurvey?.byCanvasId || {})[0];
  const offsets = (layer?.points || []).map((p) => ({
    id: p.id,
    dx: p.labelDx,
    dy: p.labelDy,
  }));
  const sides = document.querySelector('[aria-label="Point label side"]');
  const heights = document.querySelector('[aria-label="Point label seat"]');
  const pressed = [...(sides?.querySelectorAll('button') || []), ...(heights?.querySelectorAll('button') || [])]
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => (b.textContent || '').trim());
  return { offsets, pressed };
}, FILE);

check(
  'Left+Bottom stores negative labelDx on every point',
  afterLeft.offsets.length === 3 &&
    afterLeft.offsets.every((o) => typeof o.dx === 'number' && o.dx < 0),
  JSON.stringify(afterLeft.offsets),
);
check(
  'Left+Bottom pills stay highlighted',
  afterLeft.pressed.join(',') === 'Left,Bottom',
  JSON.stringify(afterLeft.pressed),
);

await page.evaluate(() => {
  const heights = document.querySelector('[aria-label="Point label seat"]');
  [...(heights?.querySelectorAll('button') || [])]
    .find((b) => (b.textContent || '').trim() === 'Center')
    ?.click();
});
await new Promise((r) => setTimeout(r, 500));

const afterCenter = await page.evaluate(() => {
  const sides = document.querySelector('[aria-label="Point label side"]');
  const heights = document.querySelector('[aria-label="Point label seat"]');
  const pressed = [...(sides?.querySelectorAll('button') || []), ...(heights?.querySelectorAll('button') || [])]
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => (b.textContent || '').trim());
  return pressed;
});
check(
  'Center alone is highlighted (no Left/Right)',
  afterCenter.join(',') === 'Center',
  JSON.stringify(afterCenter),
);

await page.screenshot({ path: `${OUT}/label-seat-show-panel.png` });

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
await browser.close();
process.exit(failed ? 1 : 0);
