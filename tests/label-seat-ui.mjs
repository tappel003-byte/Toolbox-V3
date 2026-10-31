/**
 * Control panel → Readings → Accessories → label seat writes offsets.
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
  [...document.querySelectorAll('button')].find((b) => /Control panel/i.test(b.textContent || ''))?.click();
});
await new Promise((r) => setTimeout(r, 600));
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Readings')?.click();
});
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Accessories')?.click();
});
await new Promise((r) => setTimeout(r, 400));

const seatUi = await page.evaluate(() => {
  const group = document.querySelector('[aria-label="Point label seat"]');
  if (!group) return null;
  const labels = [...group.querySelectorAll('button')].map((b) => (b.textContent || '').trim());
  return { labels };
});
check(
  'Accessories shows Left/Right/Top/Middle/Center',
  !!seatUi && seatUi.labels.join(',') === 'Left,Right,Top,Middle,Center',
  JSON.stringify(seatUi),
);

await page.evaluate(() => {
  const group = document.querySelector('[aria-label="Point label seat"]');
  [...(group?.querySelectorAll('button') || [])].find((b) => (b.textContent || '').trim() === 'Left')?.click();
});
await new Promise((r) => setTimeout(r, 500));

const offsets = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const layer = Object.values(rec.floorSurvey?.byCanvasId || {})[0];
  return (layer?.points || []).map((p) => ({
    id: p.id,
    dx: p.labelDx,
    dy: p.labelDy,
  }));
}, FILE);

check(
  'Left seat stores negative labelDx on every point',
  offsets.length === 3 && offsets.every((o) => typeof o.dx === 'number' && o.dx < 0),
  JSON.stringify(offsets),
);

await page.screenshot({ path: `${OUT}/label-seat-accessories.png` });

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
await browser.close();
process.exit(failed ? 1 : 0);
