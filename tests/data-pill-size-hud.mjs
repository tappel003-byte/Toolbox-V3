/**
 * Data H/L/Δ size HUD: unitless −|+, and −/+ stay usable (outside press dismisses).
 *
 * Run: node tests/data-pill-size-hud.mjs  (static server on 8765)
 */
import { createRequire } from 'module';
import { mkdir } from 'fs/promises';
const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
const FILE = 'data-pill-size-hud';
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
  rec.firstName = 'Hud'; rec.lastName = 'Size';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Main Level';
  await window.ToolboxDB.putMedia('plan-hud', c.toDataURL('image/png'));
  cv.plan = { id: 'plan-hud', width: 800, height: 600 };
  // Pill near known image point so we can hit it after fit.
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
          pillDx: 0,
          pillDy: 0,
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
  [...document.querySelectorAll('button')].find((b) => /^Data/.test((b.textContent || '').trim()))?.click();
});
await new Promise((r) => setTimeout(r, 2000));

// Convert plan image coords → screen using the canvas element's fit (same as PlanCanvas).
async function tapImage(ix, iy) {
  const p = await page.evaluate((ix, iy) => {
    const c = document.querySelector('canvas');
    if (!c) return null;
    const wrap = c.parentElement;
    const rect = (wrap || c).getBoundingClientRect();
    const planW = 800;
    const planH = 600;
    const scale = Math.min(rect.width / planW, rect.height / planH);
    const tx = (rect.width - planW * scale) / 2;
    const ty = (rect.height - planH * scale) / 2;
    return {
      x: rect.left + tx + ix * scale,
      y: rect.top + ty + iy * scale,
      scale, tx, ty, rect: { left: rect.left, top: rect.top, w: rect.width, h: rect.height },
    };
  }, ix, iy);
  if (!p) return null;
  await page.mouse.click(p.x, p.y, { delay: 40 });
  return p;
}

// Area centroid of the rectangle polygon ≈ (400, 300).
await tapImage(400, 300);
await new Promise((r) => setTimeout(r, 500));

let hud = await page.evaluate(() => {
  const el = document.querySelector('[data-accessory-size-hud]');
  if (!el) return null;
  return {
    text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
    hasMinus: !!el.querySelector('[aria-label="Decrease H/L/Δ size"]'),
    hasPlus: !!el.querySelector('[aria-label="Increase H/L/Δ size"]'),
    digitInHud: /\d/.test(el.textContent || ''),
  };
});

if (!hud) {
  // Nudge around the centroid in case of fit/chrome offset.
  for (const [dx, dy] of [[0, -20], [0, 20], [-40, 0], [40, 0], [0, -60], [0, 40]]) {
    await tapImage(400 + dx, 300 + dy);
    await new Promise((r) => setTimeout(r, 350));
    hud = await page.evaluate(() => {
      const el = document.querySelector('[data-accessory-size-hud]');
      if (!el) return null;
      return {
        text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
        hasMinus: !!el.querySelector('[aria-label="Decrease H/L/Δ size"]'),
        hasPlus: !!el.querySelector('[aria-label="Increase H/L/Δ size"]'),
        digitInHud: /\d/.test(el.textContent || ''),
      };
    });
    if (hud) break;
  }
}

check('size HUD opens on pill tap', !!hud, JSON.stringify(hud));
check('size HUD has − and +', !!(hud && hud.hasMinus && hud.hasPlus), JSON.stringify(hud));
check('size HUD shows no number (unitless)', !!(hud && !hud.digitInHud), JSON.stringify(hud));

await page.screenshot({ path: `${OUT}/data-pill-size-hud.png` });

if (hud) {
  await page.evaluate(() => {
    document.querySelector('[aria-label="Increase H/L/Δ size"]')?.click();
  });
  await new Promise((r) => setTimeout(r, 300));
  const still = await page.evaluate(() => !!document.querySelector('[data-accessory-size-hud]'));
  check('+/− click does not dismiss the HUD', still);

  await page.mouse.click(20, 200);
  await new Promise((r) => setTimeout(r, 300));
  const gone = await page.evaluate(() => !document.querySelector('[data-accessory-size-hud]'));
  check('outside press dismisses the HUD', gone);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
await browser.close();
process.exit(failed ? 1 : 0);
