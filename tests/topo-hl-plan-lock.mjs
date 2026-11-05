/**
 * Topo H/L/Δ lives on the plan; points/labels zoom with the canvas.
 *
 * Run: node tests/topo-hl-plan-lock.mjs  (static server on 8765)
 */
import { createRequire } from 'module';
import { mkdir } from 'fs/promises';
const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
const FILE = 'topo-hl-plan-lock';
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
  rec.firstName = 'Plan'; rec.lastName = 'Lock';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Main Level';
  await window.ToolboxDB.putMedia('plan-hl-lock', c.toDataURL('image/png'));
  cv.plan = { id: 'plan-hl-lock', width: 800, height: 600 };
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
          pillDx: -120,
          pillDy: -80,
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
await new Promise((r) => setTimeout(r, 2500));

const atFit = await page.evaluate(() => {
  const floating = !!document.querySelector('[aria-label^="Elevation stats"]');
  const canvas = document.querySelector('canvas');
  if (!canvas) return { floating, ok: false, why: 'no canvas' };
  // Ink density near plan center — plan-locked chrome leaves ink on the drawing.
  const r = canvas.getBoundingClientRect();
  return {
    floating,
    hasCanvas: true,
    cssW: Math.round(r.width),
    cssH: Math.round(r.height),
  };
});
check('Topo does not show the floating Elevation stats chip', !atFit.floating, JSON.stringify(atFit));
check('Topo canvas is present', !!atFit.hasCanvas, JSON.stringify(atFit));

await page.screenshot({ path: `${OUT}/topo-hl-plan-lock-fit.png` });

// Sample ink coverage at fit vs after zoom. Plan-locked labels/dots grow on
// screen when the plan zooms; screen-anchored chrome would stay the same CSS size.
async function inkScore() {
  return page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return null;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    const { width: w, height: h } = c;
    const data = ctx.getImageData(0, 0, w, h).data;
    let ink = 0;
    // Count near-black / saturated ink pixels (dots, label strokes, pill).
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 200) continue;
      const dark = r < 60 && g < 60 && b < 60;
      const redish = r > 160 && g < 100 && b < 100;
      const blueish = b > 140 && r < 100;
      if (dark || redish || blueish) ink += 1;
    }
    return { ink, w, h };
  });
}

const before = await inkScore();

await page.evaluate(() => {
  const c = document.querySelector('canvas');
  if (!c) return;
  const r = c.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  for (let i = 0; i < 10; i += 1) {
    c.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, clientX: cx, clientY: cy,
      deltaY: -100, ctrlKey: true,
    }));
  }
});
await new Promise((r) => setTimeout(r, 1000));

const afterZoom = await page.evaluate(() => ({
  floating: !!document.querySelector('[aria-label^="Elevation stats"]'),
}));
check('still no floating chip after zoom', !afterZoom.floating, JSON.stringify(afterZoom));

const after = await inkScore();
const grew = before && after && after.ink > before.ink * 1.15;
check(
  'plan ink grows after zoom (points/pill scale with canvas)',
  !!grew,
  JSON.stringify({ before, after }),
);

await page.screenshot({ path: `${OUT}/topo-hl-plan-lock-zoomed.png` });

const offsets = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const fs = rec.floorSurvey;
  const layer = fs && fs.byCanvasId && Object.values(fs.byCanvasId)[0];
  const area = layer && layer.areas && layer.areas[0];
  return area ? { pillDx: area.pillDx, pillDy: area.pillDy } : null;
}, FILE);
check(
  'pill offset is stored on the area (plan place)',
  !!offsets && offsets.pillDx === -120 && offsets.pillDy === -80,
  JSON.stringify(offsets),
);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
await browser.close();
process.exit(failed ? 1 : 0);
