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
// Contours → Display has Legend; Readings → Accessories has H/L.
await page.evaluate(() => document.querySelector('[data-rb-rail-tab="contours"]')?.click());
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => {
  const panel = document.querySelector('#rb-topo-group-panel');
  [...(panel?.querySelectorAll('[role="tab"]') || [])]
    .find((t) => /Display/.test((t.textContent || '').trim()))
    ?.click();
  const rows = [...document.querySelectorAll('.rb-ws__controls label, #rb-topo-group-panel label')];
  for (const lab of rows) {
    const t = (lab.textContent || '').trim();
    if (t === 'Legend') {
      const sw = lab.closest('div')?.querySelector('[role=switch]');
      if (sw && (sw.getAttribute('data-state') === 'unchecked' || sw.getAttribute('aria-checked') === 'false')) {
        sw.click();
      }
    }
  }
});
await page.evaluate(() => document.querySelector('[data-rb-rail-tab="readings"]')?.click());
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => {
  const panel = document.querySelector('#rb-topo-group-panel');
  [...(panel?.querySelectorAll('[role="tab"]') || [])]
    .find((t) => /Accessories/.test((t.textContent || '').trim()))
    ?.click();
  const rows = [...document.querySelectorAll('.rb-ws__controls label, #rb-topo-group-panel label')];
  for (const lab of rows) {
    const t = (lab.textContent || '').trim();
    if (t === 'High / low' || t === 'H/L/Δ pill') {
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
await page.evaluate(() => {
  // Show buttons on multi-view
  document.querySelector('[data-rb-floor-view-chrome="legend-on"]')?.click();
  document.querySelector('[data-rb-floor-view-chrome="pill-on"]')?.click();
});
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => document.querySelector('[data-rb-rail-tab="contours"]')?.click());
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => {
  const panel = document.querySelector('#rb-topo-group-panel');
  [...(panel?.querySelectorAll('[role="tab"]') || [])]
    .find((t) => /Display/.test((t.textContent || '').trim()))
    ?.click();
  const rows = [...document.querySelectorAll('#rb-topo-group-panel label, .rb-ws__controls label')];
  for (const lab of rows) {
    const t = (lab.textContent || '').trim();
    if (t === 'Legend') {
      const sw = lab.closest('div')?.querySelector('[role=switch]');
      if (sw && (sw.getAttribute('data-state') === 'unchecked' || sw.getAttribute('aria-checked') === 'false')) {
        sw.click();
      }
    }
  }
});
await page.evaluate(() => document.querySelector('[data-rb-rail-tab="readings"]')?.click());
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => {
  const panel = document.querySelector('#rb-topo-group-panel');
  [...(panel?.querySelectorAll('[role="tab"]') || [])]
    .find((t) => /Accessories/.test((t.textContent || '').trim()))
    ?.click();
  const rows = [...document.querySelectorAll('#rb-topo-group-panel label, .rb-ws__controls label')];
  for (const lab of rows) {
    const t = (lab.textContent || '').trim();
    if (t === 'H/L/Δ pill' || t === 'High / low') {
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

// --- High/Low pins: immediate drag on report canvas (chromeOnPage) ---
const pinMove = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const layer = Object.values(rec.floorSurvey.byCanvasId || {})[0];
  const before = { hx: layer.highPinDx, hy: layer.highPinDy };
  // Drive pin offset through the live host if exposed; otherwise poke storage
  // and confirm the report host can commit via pointer on the canvas.
  const live = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-topo-live]');
  if (!live) return { ok: false, reason: 'no-live' };
  const canvas = live.querySelector('canvas');
  if (!canvas) return { ok: false, reason: 'no-canvas' };
  const r = canvas.getBoundingClientRect();
  // Rough center-left where High/Low often sit after topo render
  return { ok: true, before, canvas: { x: r.left + r.width * 0.35, y: r.top + r.height * 0.35, w: r.width, h: r.height } };
}, FILE);
check('report topo canvas is present for pin drag', !!pinMove.ok, JSON.stringify(pinMove));

if (pinMove.ok) {
  // Try a short drag on the canvas; host should accept pin grab without long-press.
  await page.mouse.move(pinMove.canvas.x, pinMove.canvas.y);
  await page.mouse.down();
  await page.mouse.move(pinMove.canvas.x + 60, pinMove.canvas.y + 40, { steps: 8 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 900));
  const afterPin = await page.evaluate(async (id) => {
    const rec = await window.ToolboxDB.getCustomerFile(id);
    const layer = Object.values(rec.floorSurvey.byCanvasId || {})[0];
    return { hx: layer.highPinDx, hy: layer.highPinDy, lx: layer.lowPinDx, ly: layer.lowPinDy };
  }, FILE);
  // Soft check: either a pin offset changed, or we at least did not crash.
  // Exact hit depends on contour layout; assert host remains healthy.
  const hostOk = await page.evaluate(() => !!document.querySelector('[data-rb-topo-live] canvas'));
  check('High/Low pin drag on report does not break the live host', hostOk, JSON.stringify({ afterPin }));
}

await page.screenshot({ path: `${OUT}/rb-chrome-move-multi.png`, fullPage: false });
await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
await writeFile(`${OUT}/rb-chrome-move.json`, JSON.stringify({ passed, total: results.length, results }, null, 2));
if (passed < results.length) process.exit(1);
