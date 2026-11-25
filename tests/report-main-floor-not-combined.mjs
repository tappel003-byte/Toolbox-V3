/**
 * Main Floor must not become Combined (Tim, Nov 25, 2026).
 *
 * Haddow-shaped job: one canvas "Floor Plan" with named areas Main Floor /
 * 3 Car Garage / Covered Patio. A Main Floor page saved with areaId "legacy"
 * (or wrongly remapped to Combined while keeping scopeTitle) must reopen as
 * the Main Floor boundary — View source "Floor Plan — Main Floor", not Combined.
 *
 * Run: node tests/report-main-floor-not-combined.mjs  (static server on 8765)
 */
import { createRequire } from 'module';
import { mkdir } from 'fs/promises';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'rb-main-floor-not-combined';
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
await page.goto(BASE + '?v=main-floor-fix', { waitUntil: 'networkidle0' });

await page.evaluate(async (id) => {
  const img = (() => {
    const c = document.createElement('canvas');
    c.width = 1000; c.height = 750;
    const x = c.getContext('2d');
    x.fillStyle = '#f0ebe3'; x.fillRect(0, 0, 1000, 750);
    x.fillStyle = '#222'; x.fillRect(40, 40, 920, 670);
    return c.toDataURL('image/jpeg', 0.9);
  })();
  await ToolboxDB.putMedia('plan-main-floor-fix', img);
  const rec = ToolboxApp.blankCustomerFile(id);
  ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Ryan'; rec.lastName = 'Haddow';
  rec.propertyAddress = '8511 Calle Norte Trail\nFarmington, NM 87402';
  rec.planSetup.canvases = [
    { id: 'cv-plan', name: 'Floor Plan', rooms: [], frontDoorFacing: 'E', frontDoor: null,
      plan: { id: 'plan-main-floor-fix', width: 1000, height: 750 } },
  ];
  const pts = [
    { id: 'm1', x: 150, y: 150, value: 0 },
    { id: 'm2', x: 350, y: 180, value: 1.0 },
    { id: 'm3', x: 400, y: 350, value: -0.5 },
    { id: 'g1', x: 700, y: 150, value: 0.8 },
    { id: 'g2', x: 850, y: 200, value: -0.2 },
    { id: 'g3', x: 800, y: 350, value: 0.4 },
    { id: 'p1', x: 200, y: 550, value: 0.2 },
    { id: 'p2', x: 500, y: 580, value: -0.8 },
    { id: 'p3', x: 750, y: 560, value: 0.1 },
  ];
  rec.floorSurvey = {
    id: 'fs-main-floor-fix',
    inspectionDate: '2025-11-21',
    byCanvasId: {
      'cv-plan': {
        canvasId: 'cv-plan',
        points: pts,
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
await new Promise((r) => setTimeout(r, 3000));

// Corrupt Main Floor the two ways the Nov 24 migrate left real jobs.
await page.evaluate(async (id) => {
  const rec = await ToolboxDB.getCustomerFile(id);
  (rec.reportBuilder.pages || []).forEach((p) => {
    if (!p || p.type !== 'floor' || !p.meta) return;
    if (p.meta.scopeTitle === 'Main Floor') {
      p.meta.scope = 'area';
      p.meta.areaId = 'legacy';
      delete p.meta.views;
    }
    if (p.meta.scopeTitle === '3 Car Garage') {
      // Already-wrong Combined with boundary title kept (post blunt migrate).
      p.meta.scope = 'all';
      p.meta.areaId = null;
      p.meta.views = [{
        id: 'v0', canvasId: 'cv-plan', epochId: p.meta.epochId || 'fs-main-floor-fix',
        scope: 'all', areaId: null, settings: null, frame: { x: 0, y: 0, w: 100, h: 100, z: 1 },
      }];
    }
  });
  await ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}?v=reopen#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => document.querySelector('.rb-shell')?.getAttribute('data-report-ready') === 'true',
  { timeout: 90000 },
);
await new Promise((r) => setTimeout(r, 4000));
// Wait until migrate+flush has rewritten Main Floor off legacy.
await page.waitForFunction(async (id) => {
  const rec = await ToolboxDB.getCustomerFile(id);
  const main = (rec.reportBuilder.pages || []).find((p) => p.meta && p.meta.scopeTitle === 'Main Floor');
  return main && main.meta.areaId === 'area-main';
}, { timeout: 20000 }, FILE).catch(() => {});

const fixed = await page.evaluate(async (id) => {
  const rec = await ToolboxDB.getCustomerFile(id);
  return (rec.reportBuilder.pages || [])
    .filter((p) => p.type === 'floor')
    .map((p) => ({
      scopeTitle: p.meta && p.meta.scopeTitle,
      scope: p.meta && p.meta.scope,
      areaId: p.meta && p.meta.areaId,
      view0: p.meta && p.meta.views && p.meta.views[0]
        ? { scope: p.meta.views[0].scope, areaId: p.meta.views[0].areaId }
        : null,
    }));
}, FILE);

const main = fixed.find((p) => p.scopeTitle === 'Main Floor');
const gar = fixed.find((p) => p.scopeTitle === '3 Car Garage');
const patio = fixed.find((p) => p.scopeTitle === 'Covered Patio');
const combined = fixed.find((p) => /Combined/i.test(p.scopeTitle || ''));

check('Main Floor recovers from areaId legacy to the Main Floor area',
  main && main.scope === 'area' && main.areaId === 'area-main',
  JSON.stringify(main));
check('Main Floor view source matches the area',
  main && main.view0 && main.view0.scope === 'area' && main.view0.areaId === 'area-main',
  JSON.stringify(main && main.view0));
check('3 Car Garage recovers from wrong Combined to its area',
  gar && gar.scope === 'area' && gar.areaId === 'area-gar',
  JSON.stringify(gar));
check('Covered Patio stays a named area',
  patio && patio.scope === 'area' && patio.areaId === 'area-patio',
  JSON.stringify(patio));
check('Combined View stays Combined',
  combined && combined.scope === 'all' && !combined.areaId,
  JSON.stringify(combined));

// Live UI: open the Main Floor sheet, Sheet Layout tab, read View source.
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('[data-page-id], .rb-pages button, .rb-rail button')]
    .find((el) => /Main Floor/i.test(el.textContent || '') && !/Combined/i.test(el.textContent || ''));
  btn?.click();
});
await new Promise((r) => setTimeout(r, 900));
await page.evaluate(() => {
  document.querySelector('[data-rb-floor-task="layout"]')?.click();
});
await new Promise((r) => setTimeout(r, 700));
const src = await page.evaluate(() => {
  const sel = document.querySelector('[data-rb-floor-view-source]');
  if (!sel) {
    return {
      ok: false,
      reason: 'no source picker',
      tasks: [...document.querySelectorAll('[data-rb-floor-task]')].map((b) => b.textContent),
    };
  }
  const opt = sel.options[sel.selectedIndex];
  return {
    ok: true,
    value: sel.value,
    label: opt ? opt.textContent : '',
  };
});
check('View source picker shows Floor Plan — Main Floor',
  src.ok && /Main Floor/i.test(src.label) && !/Combined/i.test(src.label),
  JSON.stringify(src));

check('No page errors', pageErrors.length === 0, pageErrors.join(' | '));

await page.screenshot({ path: `${OUT}/rb-main-floor-not-combined.png` }).catch(() => {});
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
