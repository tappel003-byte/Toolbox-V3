/**
 * Legend, H/L/Δ pill, and High/Low pins must move on the report sheet —
 * single-view and multi-view alike (Tim, Oct 26, 2026).
 * Run: node tests/report-floor-chrome-move.mjs  (static server on 8765)
 */
import { createRequire } from 'module';
import { mkdir, writeFile } from 'fs/promises';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
const FILE = 'rb-chrome-move';
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
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

await page.evaluate(async (id) => {
  const c = document.createElement('canvas');
  c.width = 800; c.height = 600;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 800, 600);
  x.strokeStyle = '#111'; x.strokeRect(20, 20, 760, 560);
  await window.ToolboxDB.putMedia('plan-move', c.toDataURL('image/jpeg', 0.9));
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Move'; rec.lastName = 'Chrome';
  rec.propertyAddress = '2 Move Lane';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Main Level';
  cv.plan = { id: 'plan-move', width: 800, height: 600 };
  cv.frontDoorFacing = 'N';
  const poly = [{ x: 40, y: 40 }, { x: 760, y: 40 }, { x: 760, y: 560 }, { x: 40, y: 560 }];
  const points = [];
  for (let i = 1; i <= 8; i += 1) {
    points.push({
      id: 'p' + i, floorId: cv.id, index: i,
      x: 80 + i * 70, y: 180 + (i % 3) * 40, value: 5 + i * 0.25,
    });
  }
  rec.floorSurvey = {
    id: 'fs-move', inspectionDate: '2026-10-26',
    byCanvasId: {
      [cv.id]: {
        canvasId: cv.id, points,
        areas: [{ id: 'a1', name: 'Main Level', polygon: poly, createdAt: 1 }],
        boundary: poly,
      },
    },
  };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 4500));
await page.evaluate(() => {
  const t = [...document.querySelectorAll('.rb-thumb[data-page-id^="floor-"]')]
    .find((el) => !/reserved/i.test(el.getAttribute('data-page-id') || ''))
    || [...document.querySelectorAll('.rb-thumb[data-page-id^="floor-"]')][0];
  t?.click();
});
await page.waitForFunction(
  () => !!document.querySelector('[data-rb-floor-import]') ||
    !!document.querySelector('[data-rb-floor-box^="topo"]') ||
    !!document.querySelector('[data-rb-floor-task]'),
  { timeout: 25000 });
const needsImport = await page.evaluate(() => {
  const btn = document.querySelector('[data-rb-floor-import]');
  if (!btn) return false;
  btn.click();
  return true;
});
if (needsImport) {
  await page.waitForFunction(
    () => !!document.querySelector('[data-rb-floor-box^="topo"]'),
    { timeout: 30000 });
}
await new Promise((r) => setTimeout(r, 2200));

async function openTask(which) {
  await page.evaluate((w) => document.querySelector(`[data-rb-floor-task="${w}"]`)?.click(), which);
  await new Promise((r) => setTimeout(r, 500));
}

const box = async (id) => page.evaluate((b) => {
  const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
  const stage = sheet?.querySelector('[data-rb-floor-stage]');
  const el = sheet?.querySelector(`[data-rb-floor-box="${b}"]`);
  if (!el || !stage) return null;
  const r = el.getBoundingClientRect();
  const sr = stage.getBoundingClientRect();
  return {
    id: b,
    leftPct: +(((r.left - sr.left) / sr.width) * 100).toFixed(1),
    topPct: +(((r.top - sr.top) / sr.height) * 100).toFixed(1),
  };
}, id);

async function dragBox(id, dx, dy) {
  const at = await page.evaluate((b) => {
    const el = document.querySelector(`.rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-box="${b}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + Math.min(20, r.height / 2) };
  }, id);
  if (!at) return false;
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + dx, at.y + dy, { steps: 12 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 500));
  return true;
}

// --- Single-view: legend-0 / pill-0 ---
await openTask('topo');
await page.evaluate(() => {
  document.querySelector('[data-rb-floor-view-chrome="legend-on"]')?.click();
  document.querySelector('[data-rb-floor-view-chrome="pill-on"]')?.click();
});
await new Promise((r) => setTimeout(r, 800));
// Also enable via Topo accordions if chrome buttons absent (single-view defaults may already show)
await page.evaluate(() => {
  document.querySelector('[data-rb-rail-tab="legendhl"]')?.click();
});
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.rb-ws__controls label')];
  for (const lab of rows) {
    const t = (lab.textContent || '').trim();
    if (t === 'Legend' || t === 'H/L/Δ pill' || t === 'High / low') {
      const sw = lab.closest('div')?.querySelector('[role=switch]');
      if (sw && (sw.getAttribute('data-state') === 'unchecked' || sw.getAttribute('aria-checked') === 'false')) {
        sw.click();
      }
    }
  }
});
await new Promise((r) => setTimeout(r, 1200));

let legendId = await page.evaluate(() => {
  const el = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-kind="legend"]');
  return el?.getAttribute('data-rb-floor-box') || null;
});
let pillId = await page.evaluate(() => {
  const el = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-kind="pill"]');
  return el?.getAttribute('data-rb-floor-box') || null;
});
check('single-view sheet has a legend and a pill box', !!legendId && !!pillId, JSON.stringify({ legendId, pillId }));

const legBefore = await box(legendId);
await dragBox(legendId, 140, 80);
const legAfter = await box(legendId);
check('single-view contour legend moves',
  legBefore && legAfter &&
    (Math.abs(legAfter.leftPct - legBefore.leftPct) > 3 || Math.abs(legAfter.topPct - legBefore.topPct) > 3),
  JSON.stringify({ legBefore, legAfter }));

const pillBefore = await box(pillId);
await dragBox(pillId, 120, 90);
const pillAfter = await box(pillId);
check('single-view H/L/Δ pill moves',
  pillBefore && pillAfter &&
    (Math.abs(pillAfter.leftPct - pillBefore.leftPct) > 3 || Math.abs(pillAfter.topPct - pillBefore.topPct) > 3),
  JSON.stringify({ pillBefore, pillAfter }));

// Persist check via layout overlays
await new Promise((r) => setTimeout(r, 1200));
const savedSingle = await page.evaluate((id) => {
  return window.ToolboxDB.getCustomerFile(id).then((rec) => {
    const page = (rec.reportBuilder.pages || []).find((p) => p && p.type === 'floor' && !p.meta?.reserved);
    const layout = page?.meta?.ownLayout || rec.reportBuilder.floorLayout || null;
    const overlays = (layout && layout.overlays) || [];
    return overlays.map((o) => ({ id: o.id, kind: o.kind, x: o.x, y: o.y }));
  });
}, FILE);
const legSaved = savedSingle.find((o) => o.id === legendId);
const pillSaved = savedSingle.find((o) => o.id === pillId);
check('moved chrome positions are stored in floorLayout.overlays',
  legSaved && pillSaved &&
    Math.abs(legSaved.x - legAfter.leftPct) < 2 &&
    Math.abs(pillSaved.x - pillAfter.leftPct) < 2,
  JSON.stringify({ savedSingle, legAfter, pillAfter }));

// --- High/Low pins: press-and-move on the report canvas (same as field) ---
// Find the drawn High pin (#b51d16) on the live canvas, then drag its center.
// Report sheets CSS-scale the host; screen coords must include hostScale
// (inverse of PlanCanvas.toImage). Geometry guesses miss when legend/pill
// HTML overlays sit nearby or the fit transform letterboxes the plan.
const pinMove = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const layer = Object.values(rec.floorSurvey.byCanvasId || {})[0];
  const before = {
    hx: layer.highPinDx ?? 0,
    hy: layer.highPinDy ?? 0,
  };
  const pts = layer.points || [];
  let hi = pts[0];
  for (const p of pts) if (p && (!hi || p.value > hi.value)) hi = p;
  const live = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-topo-live]');
  if (!live) return { ok: false, reason: 'no-live' };
  const viewport = live.querySelector('[data-floor-viewport]');
  const canvas = live.querySelector('canvas');
  if (!viewport || !canvas || !hi) return { ok: false, reason: 'no-viewport-or-hi' };
  const scale = Number(viewport.getAttribute('data-canvas-scale'));
  const tx = Number(viewport.getAttribute('data-canvas-tx'));
  const ty = Number(viewport.getAttribute('data-canvas-ty'));
  if (!(scale > 0)) return { ok: false, reason: 'bad-transform', scale, tx, ty };
  const rect = viewport.getBoundingClientRect();
  const hostScale = rect.width / (viewport.offsetWidth || rect.width);
  if (!(hostScale > 0)) return { ok: false, reason: 'bad-hostScale', hostScale };

  const ctx = canvas.getContext('2d');
  if (!ctx) return { ok: false, reason: 'no-ctx' };
  const x0 = Math.max(0, Math.floor((tx + (hi.x + before.hx - 50) * scale) * canvas.width / canvas.offsetWidth));
  const x1 = Math.min(canvas.width - 1, Math.ceil((tx + (hi.x + before.hx + 50) * scale) * canvas.width / canvas.offsetWidth));
  const y0 = Math.max(0, Math.floor((ty + (hi.y + before.hy - 60) * scale) * canvas.height / canvas.offsetHeight));
  const y1 = Math.min(canvas.height - 1, Math.ceil((ty + (hi.y + before.hy + 20) * scale) * canvas.height / canvas.offsetHeight));
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  let img;
  try { img = ctx.getImageData(x0, y0, w, h); }
  catch (e) { return { ok: false, reason: 'getImageData', error: String(e) }; }
  let minx = 1e9, miny = 1e9, maxx = -1, maxy = -1, count = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
      // High pin fill #b51d16
      if (Math.abs(r - 181) < 25 && Math.abs(g - 29) < 25 && Math.abs(b - 22) < 25) {
        count++;
        if (x < minx) minx = x;
        if (y < miny) miny = y;
        if (x > maxx) maxx = x;
        if (y > maxy) maxy = y;
      }
    }
  }
  if (!count) {
    return {
      ok: false, reason: 'no-high-pin-pixels', before,
      hi: { x: hi.x, y: hi.y, value: hi.value },
      transform: { scale, tx, ty, hostScale },
    };
  }
  const cxBmp = x0 + (minx + maxx) / 2;
  const cyBmp = y0 + (miny + maxy) / 2;
  const lx = cxBmp * canvas.offsetWidth / canvas.width;
  const ly = cyBmp * canvas.offsetHeight / canvas.height;
  const sx = rect.left + lx * hostScale;
  const sy = rect.top + ly * hostScale;
  return {
    ok: true,
    before,
    hi: { x: hi.x, y: hi.y, value: hi.value },
    screen: { x: sx, y: sy },
    pinPixels: count,
    transform: { scale, tx, ty, hostScale },
  };
}, FILE);
check('report topo canvas is present for High pin drag', !!pinMove.ok, JSON.stringify(pinMove));

if (pinMove.ok) {
  await page.mouse.move(pinMove.screen.x, pinMove.screen.y);
  await page.mouse.down();
  await page.mouse.move(pinMove.screen.x + 70, pinMove.screen.y + 50, { steps: 10 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 1000));
  const afterPin = await page.evaluate(async (id) => {
    const rec = await window.ToolboxDB.getCustomerFile(id);
    const layer = Object.values(rec.floorSurvey.byCanvasId || {})[0];
    return {
      hx: layer.highPinDx ?? 0,
      hy: layer.highPinDy ?? 0,
      lx: layer.lowPinDx ?? 0,
      ly: layer.lowPinDy ?? 0,
    };
  }, FILE);
  const moved =
    Math.abs(afterPin.hx - pinMove.before.hx) > 2 ||
    Math.abs(afterPin.hy - pinMove.before.hy) > 2;
  check('High marker moves on the report slide (highPinDx/Dy change)',
    moved,
    JSON.stringify({ before: pinMove.before, afterPin, hi: pinMove.hi }));
}

// --- Multi-view: Add view, enable chrome on selected view, drag view-scoped ids ---
await openTask('layout');
await page.evaluate(() => document.querySelector('[data-rb-floor-view="add"]')?.click());
await page.waitForFunction(
  () => document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) [data-rb-topo-frame]').length >= 2,
  { timeout: 20000 });
await new Promise((r) => setTimeout(r, 1000));
await page.evaluate(() => {
  document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-topo-frame="0"]')
    ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 500));
await openTask('topo');
await page.evaluate(() => document.querySelector('[data-rb-rail-tab="legendhl"]')?.click());
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => {
  // Show buttons on multi-view
  document.querySelector('[data-rb-floor-view-chrome="legend-on"]')?.click();
  document.querySelector('[data-rb-floor-view-chrome="pill-on"]')?.click();
});
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.rb-ws__controls label')];
  for (const lab of rows) {
    const t = (lab.textContent || '').trim();
    if (t === 'Legend' || t === 'H/L/Δ pill' || t === 'High / low') {
      const sw = lab.closest('div')?.querySelector('[role=switch]');
      if (sw && (sw.getAttribute('data-state') === 'unchecked' || sw.getAttribute('aria-checked') === 'false')) {
        sw.click();
      }
    }
  }
});
await new Promise((r) => setTimeout(r, 1500));

legendId = await page.evaluate(() => {
  const el = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-kind="legend"]');
  return el?.getAttribute('data-rb-floor-box') || null;
});
pillId = await page.evaluate(() => {
  const el = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-kind="pill"]');
  return el?.getAttribute('data-rb-floor-box') || null;
});
check('multi-view chrome uses view-scoped overlay ids',
  !!legendId && !!pillId && legendId !== 'legend-0',
  JSON.stringify({ legendId, pillId }));

const mLegBefore = await box(legendId);
await dragBox(legendId, 110, 70);
const mLegAfter = await box(legendId);
check('multi-view contour legend moves',
  mLegBefore && mLegAfter &&
    (Math.abs(mLegAfter.leftPct - mLegBefore.leftPct) > 3 || Math.abs(mLegAfter.topPct - mLegBefore.topPct) > 3),
  JSON.stringify({ mLegBefore, mLegAfter, legendId }));

const mPillBefore = await box(pillId);
await dragBox(pillId, 100, 85);
const mPillAfter = await box(pillId);
check('multi-view H/L/Δ pill moves',
  mPillBefore && mPillAfter &&
    (Math.abs(mPillAfter.leftPct - mPillBefore.leftPct) > 3 || Math.abs(mPillAfter.topPct - mPillBefore.topPct) > 3),
  JSON.stringify({ mPillBefore, mPillAfter, pillId }));

await new Promise((r) => setTimeout(r, 1200));
const savedMulti = await page.evaluate((id) => {
  return window.ToolboxDB.getCustomerFile(id).then((rec) => {
    const page = (rec.reportBuilder.pages || []).find((p) => p && p.type === 'floor' && !p.meta?.reserved);
    const layout = page?.meta?.ownLayout || rec.reportBuilder.floorLayout || null;
    return ((layout && layout.overlays) || []).map((o) => ({
      id: o.id, kind: o.kind,
      x: typeof o.x === 'number' ? +o.x.toFixed(1) : o.x,
      y: typeof o.y === 'number' ? +o.y.toFixed(1) : o.y,
    }));
  });
}, FILE);
const mLegSaved = savedMulti.find((o) => o.id === legendId);
const mPillSaved = savedMulti.find((o) => o.id === pillId);
check('multi-view chrome ids persist in overlays after drag',
  mLegSaved && mPillSaved &&
    Math.abs(mLegSaved.x - mLegAfter.leftPct) < 2 &&
    Math.abs(mPillSaved.x - mPillAfter.leftPct) < 2,
  JSON.stringify({ savedMulti, mLegAfter, mPillAfter }));

await page.screenshot({ path: `${OUT}/rb-chrome-move-multi.png`, fullPage: false });
await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
await writeFile(`${OUT}/rb-chrome-move.json`, JSON.stringify({ passed, total: results.length, results }, null, 2));
if (passed < results.length) process.exit(1);
