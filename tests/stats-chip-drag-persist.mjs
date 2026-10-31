/**
 * Floating H/L/Δ StatsChip keeps the place you drag it to across remount.
 *
 * Run: node tests/stats-chip-drag-persist.mjs  (static server on 8765)
 *
 * endDrag used to JSON.stringify closed-over React `pos`, which can still be
 * the pre-drag value when pointerup races the last setPos — so Clean view /
 * Data↔Topo remount snapped the chip back.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'stats-chip-drag';
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
  x.fillStyle = '#f5f0e6'; x.fillRect(0, 0, 800, 600);
  x.strokeStyle = '#333'; x.lineWidth = 4; x.strokeRect(40, 40, 720, 520);
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Chip'; rec.lastName = 'Drag';
  rec.propertyAddress = '1 Persist Lane';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Main Level';
  await window.ToolboxDB.putMedia('plan-chip-drag', c.toDataURL('image/png'));
  cv.plan = { id: 'plan-chip-drag', width: 800, height: 600 };
  rec.floorSurvey = {
    id: 'fs-' + id,
    inspectionDate: '2026-10-30',
    byCanvasId: {
      [cv.id]: {
        canvasId: cv.id,
        inspectionDate: '2026-10-30',
        points: [
          { id: 'hi', floorId: cv.id, index: 1, x: 500, y: 200, value: 3.3 },
          { id: 'lo', floorId: cv.id, index: 2, x: 200, y: 400, value: 1.1 },
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
await page.waitForFunction(() => !!document.querySelector('[aria-label^="Elevation stats"]'), { timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));

// Switch to Topo so the field chrome layout matches Tim's screen.
await page.evaluate(() => {
  const topo = [...document.querySelectorAll('button')].find((b) => /Topo/.test(b.textContent || ''));
  topo?.click();
});
await new Promise((r) => setTimeout(r, 1500));
await page.waitForFunction(() => !!document.querySelector('[aria-label^="Elevation stats"]'), { timeout: 30000 });

const before = await page.evaluate(() => {
  const el = document.querySelector('[aria-label^="Elevation stats"]');
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});

const target = { x: 24, y: 120 };
await page.evaluate((from, to) => {
  const el = document.querySelector('[aria-label^="Elevation stats"]');
  const cx = from.x + from.w / 2;
  const cy = from.y + from.h / 2;
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy, pointerId: 1 }));
  el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cx + 8, clientY: cy + 8, pointerId: 1 }));
  el.dispatchEvent(new PointerEvent('pointermove', {
    bubbles: true,
    clientX: to.x + from.w / 2,
    clientY: to.y + from.h / 2,
    pointerId: 1,
  }));
  el.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true,
    clientX: to.x + from.w / 2,
    clientY: to.y + from.h / 2,
    pointerId: 1,
  }));
}, before, target);
await new Promise((r) => setTimeout(r, 400));

const afterDrag = await page.evaluate(() => {
  const el = document.querySelector('[aria-label^="Elevation stats"]');
  const r = el.getBoundingClientRect();
  const keys = Object.keys(localStorage).filter((k) => k.startsWith('stats-chip-pos:'));
  const stored = keys.map((k) => ({ k, v: localStorage.getItem(k) }));
  return { x: r.left, y: r.top, stored };
});

check('drag moves the chip away from its start',
  Math.hypot(afterDrag.x - before.x, afterDrag.y - before.y) > 40,
  JSON.stringify({ before, afterDrag }));

check('localStorage holds the dragged place (not the start)',
  afterDrag.stored.some((s) => {
    try {
      const p = JSON.parse(s.v);
      return Math.abs(p.x - afterDrag.x) <= 3 && Math.abs(p.y - afterDrag.y) <= 3;
    } catch { return false; }
  }),
  JSON.stringify(afterDrag.stored));

// Remount chrome the way Clean view does (hide StatsChip, then show again).
await page.evaluate(() => {
  const clean = [...document.querySelectorAll('button')].find((b) =>
    /Clean|Chrome/.test((b.getAttribute('aria-label') || '') + (b.textContent || '')));
  clean?.click();
});
await new Promise((r) => setTimeout(r, 500));
await page.evaluate(() => {
  const chrome = [...document.querySelectorAll('button')].find((b) =>
    /Clean|Chrome/.test((b.getAttribute('aria-label') || '') + (b.textContent || '')));
  chrome?.click();
});
await page.waitForFunction(() => !!document.querySelector('[aria-label^="Elevation stats"]'), { timeout: 15000 });
await new Promise((r) => setTimeout(r, 400));

const afterRemount = await page.evaluate(() => {
  const el = document.querySelector('[aria-label^="Elevation stats"]');
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top };
});

check('after Clean remount the chip is still where it was dragged',
  Math.abs(afterRemount.x - afterDrag.x) <= 3 && Math.abs(afterRemount.y - afterDrag.y) <= 3,
  JSON.stringify({ afterDrag, afterRemount }));

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
await browser.close();
process.exit(failed ? 1 : 0);
