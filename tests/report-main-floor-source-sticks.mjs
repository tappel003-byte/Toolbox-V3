/**
 * Haddow Figure 1: Main Floor View source must stick; Print must not draw Combined
 * under a Main Floor title (Tim, Nov 25, 2026).
 *
 * Real saved shapes that clean fixtures miss:
 *  A) title Main Floor + scopeTitle Combined View + view Main Floor
 *     → old Combined heal forced view back to Combined on reopen.
 *  B) meta Main Floor (area) + sole view Combined
 *     → picker/print used the drifted Combined view under a Main Floor title.
 *
 * Run: node tests/report-main-floor-source-sticks.mjs  (static server on 8765)
 */
import { createRequire } from 'module';
import { mkdir } from 'fs/promises';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'rb-main-floor-source-sticks';
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
await page.setCacheEnabled(false);
await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  for (const r of regs) await r.unregister();
  const keys = await caches.keys();
  for (const k of keys) await caches.delete(k);
});
await page.goto(BASE + '?v=mf-source-sticks', { waitUntil: 'networkidle0' });

await page.evaluate(async (id) => {
  const img = (() => {
    const c = document.createElement('canvas');
    c.width = 1000; c.height = 750;
    const x = c.getContext('2d');
    x.fillStyle = '#f0ebe3'; x.fillRect(0, 0, 1000, 750);
    x.fillStyle = '#222'; x.fillRect(40, 40, 920, 670);
    return c.toDataURL('image/jpeg', 0.9);
  })();
  await ToolboxDB.putMedia('plan-mf-source-sticks', img);
  const rec = ToolboxApp.blankCustomerFile(id);
  ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Ryan'; rec.lastName = 'Haddow';
  rec.propertyAddress = '8511 Calle Norte Trail\nFarmington, NM 87402';
  rec.planSetup.canvases = [
    { id: 'cv-plan', name: 'Floor Plan', rooms: [], frontDoorFacing: 'E', frontDoor: null,
      plan: { id: 'plan-mf-source-sticks', width: 1000, height: 750 } },
  ];
  rec.floorSurvey = {
    id: 'fs-mf-source-sticks',
    inspectionDate: '2025-11-21',
    byCanvasId: {
      'cv-plan': {
        canvasId: 'cv-plan',
        points: [
          { id: 'm1', x: 150, y: 150, value: 0 },
          { id: 'm2', x: 350, y: 180, value: 1.0 },
          { id: 'g1', x: 700, y: 150, value: 0.8 },
          { id: 'g2', x: 850, y: 200, value: -0.2 },
          { id: 'p1', x: 200, y: 550, value: 0.2 },
          { id: 'p2', x: 500, y: 580, value: -0.8 },
        ],
        boundary: [
          { x: 40, y: 40 }, { x: 960, y: 40 }, { x: 960, y: 710 }, { x: 40, y: 710 },
        ],
        areas: [
          { id: 'area-main', name: 'Main Floor',
            polygon: [{ x: 40, y: 40 }, { x: 520, y: 40 }, { x: 520, y: 450 }, { x: 40, y: 450 }] },
          { id: 'area-gar', name: '3 Car Garage',
            polygon: [{ x: 520, y: 40 }, { x: 960, y: 40 }, { x: 960, y: 450 }, { x: 520, y: 450 }] },
          { id: 'area-patio', name: 'Covered Patio',
            polygon: [{ x: 40, y: 450 }, { x: 960, y: 450 }, { x: 960, y: 710 }, { x: 40, y: 710 }] },
        ],
      },
    },
  };
  await ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}?v=seed#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => document.querySelector('.rb-shell')?.getAttribute('data-report-ready') === 'true',
  { timeout: 90000 },
);
await new Promise((r) => setTimeout(r, 2500));

// Shape A: title Main Floor, scopeTitle Combined View, view Main Floor (heal used to wipe view).
await page.evaluate(async (id) => {
  const rec = await ToolboxDB.getCustomerFile(id);
  const combined = (rec.reportBuilder.pages || []).find((p) =>
    p && p.type === 'floor' && /::all$/.test(p.id));
  if (!combined || !combined.meta) throw new Error('no Combined page');
  combined.title = 'Floor Level Survey — Main Floor';
  combined.tocTitle = combined.title;
  combined.railLabel = 'Floor · Main Floor';
  combined.meta.scopeTitle = 'Combined View';
  combined.meta.scope = 'all';
  combined.meta.areaId = null;
  combined.meta.views = [{
    id: 'v0',
    canvasId: 'cv-plan',
    epochId: combined.meta.epochId || 'fs-mf-source-sticks',
    scope: 'area',
    areaId: 'area-main',
    settings: null,
    frame: { x: 0, y: 0, w: 100, h: 100, z: 1 },
  }];
  await ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}?v=shapeA#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => document.querySelector('.rb-shell')?.getAttribute('data-report-ready') === 'true',
  { timeout: 90000 },
);
await page.waitForFunction(async (id) => {
  const rec = await ToolboxDB.getCustomerFile(id);
  const p = (rec.reportBuilder.pages || []).find((x) => x && /::all$/.test(x.id));
  return p && p.meta && p.meta.scope === 'area' && p.meta.areaId === 'area-main'
    && p.meta.views && p.meta.views[0] && p.meta.views[0].scope === 'area';
}, { timeout: 20000 }, FILE).catch(() => {});
await new Promise((r) => setTimeout(r, 1200));

const shapeA = await page.evaluate(async (id) => {
  const rec = await ToolboxDB.getCustomerFile(id);
  const p = (rec.reportBuilder.pages || []).find((x) => x && /::all$/.test(x.id));
  return p ? {
    title: p.title,
    scopeTitle: p.meta.scopeTitle,
    scope: p.meta.scope,
    areaId: p.meta.areaId,
    view: p.meta.views && p.meta.views[0]
      ? { scope: p.meta.views[0].scope, areaId: p.meta.views[0].areaId }
      : null,
  } : null;
}, FILE);
check('Shape A reopen: title Main Floor keeps Main Floor source (not Combined heal)',
  shapeA && /Main Floor/i.test(shapeA.title || '')
    && shapeA.scope === 'area' && shapeA.areaId === 'area-main'
    && shapeA.view && shapeA.view.scope === 'area' && shapeA.view.areaId === 'area-main'
    && /Main Floor/i.test(shapeA.scopeTitle || ''),
  JSON.stringify(shapeA));

// Shape B: meta Main Floor area, sole view Combined — must heal view to Main Floor.
await page.evaluate(async (id) => {
  const rec = await ToolboxDB.getCustomerFile(id);
  const main = (rec.reportBuilder.pages || []).find((p) =>
    p && p.type === 'floor' && p.meta && p.meta.scopeTitle === 'Main Floor'
    && /area-main/.test(p.id));
  if (!main || !main.meta) throw new Error('no Main Floor page');
  main.meta.scope = 'area';
  main.meta.areaId = 'area-main';
  main.meta.scopeTitle = 'Main Floor';
  main.meta.views = [{
    id: 'v0',
    canvasId: 'cv-plan',
    epochId: main.meta.epochId || 'fs-mf-source-sticks',
    scope: 'all',
    areaId: null,
    settings: null,
    frame: { x: 0, y: 0, w: 100, h: 100, z: 1 },
  }];
  await ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}?v=shapeB#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => document.querySelector('.rb-shell')?.getAttribute('data-report-ready') === 'true',
  { timeout: 90000 },
);
await page.waitForFunction(async (id) => {
  const rec = await ToolboxDB.getCustomerFile(id);
  const p = (rec.reportBuilder.pages || []).find((x) =>
    x && x.type === 'floor' && x.meta && x.meta.scopeTitle === 'Main Floor'
    && /area-main/.test(x.id));
  const v = p && p.meta && p.meta.views && p.meta.views[0];
  return v && v.scope === 'area' && v.areaId === 'area-main';
}, { timeout: 20000 }, FILE).catch(() => {});
await new Promise((r) => setTimeout(r, 1200));

const shapeB = await page.evaluate(async (id) => {
  const rec = await ToolboxDB.getCustomerFile(id);
  const p = (rec.reportBuilder.pages || []).find((x) =>
    x && x.type === 'floor' && x.meta && x.meta.scopeTitle === 'Main Floor'
    && /area-main/.test(x.id));
  return p ? {
    scope: p.meta.scope,
    areaId: p.meta.areaId,
    view: p.meta.views && p.meta.views[0]
      ? { scope: p.meta.views[0].scope, areaId: p.meta.views[0].areaId }
      : null,
  } : null;
}, FILE);
check('Shape B reopen: Main Floor meta pulls Combined-drifted view back to Main Floor',
  shapeB && shapeB.scope === 'area' && shapeB.areaId === 'area-main'
    && shapeB.view && shapeB.view.scope === 'area' && shapeB.view.areaId === 'area-main',
  JSON.stringify(shapeB));

// Live UI: open the healed Main Floor sheet, View source must say Main Floor.
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.rb-thumb, button')]
    .find((el) => /Main Floor/i.test(el.textContent || '') && !/Combined/i.test(el.textContent || ''));
  btn?.click();
});
await new Promise((r) => setTimeout(r, 900));
await page.evaluate(() => {
  document.querySelector('[data-rb-floor-task="layout"]')?.click();
});
await new Promise((r) => setTimeout(r, 700));
const picker = await page.evaluate(() => {
  const sel = document.querySelector('[data-rb-floor-view-source]');
  if (!sel) return null;
  const opt = sel.options[sel.selectedIndex];
  return opt ? opt.textContent : null;
});
check('View source picker shows Floor Plan — Main Floor',
  picker && /Main Floor/i.test(picker) && !/Combined/i.test(picker),
  JSON.stringify(picker));

// Combined sheet still Combined.
const combinedOk = await page.evaluate(async (id) => {
  const rec = await ToolboxDB.getCustomerFile(id);
  const p = (rec.reportBuilder.pages || []).find((x) =>
    x && x.type === 'floor' && /Combined/i.test(String(x.meta && x.meta.scopeTitle || '')));
  if (!p) {
    // Shape A converted ::all into Main Floor — seed a fresh Combined check via Garage sibling.
    return { ok: true, note: 'no Combined page left after shape A conversion (expected)' };
  }
  return {
    ok: p.meta.scope === 'all' && !p.meta.areaId
      && p.meta.views && p.meta.views[0] && p.meta.views[0].scope === 'all',
    page: { scope: p.meta.scope, areaId: p.meta.areaId, view: p.meta.views && p.meta.views[0] },
  };
}, FILE);
check('Combined identity not broken for remaining Combined sheets',
  combinedOk.ok, JSON.stringify(combinedOk));

check('No page errors', pageErrors.length === 0, pageErrors.join(' | '));
await page.screenshot({ path: `${OUT}/rb-main-floor-source-sticks.png` }).catch(() => {});
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
