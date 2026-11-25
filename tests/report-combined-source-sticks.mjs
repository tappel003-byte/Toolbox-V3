/**
 * Combined View source must stick (Tim, Nov 25, 2026).
 *
 * Failure shape: Combined page meta stays Combined View / scope=all, but the
 * sole view sits on Main Floor. Tim had to select Combined every open.
 *
 * Run: node tests/report-combined-source-sticks.mjs  (static server on 8765)
 */
import { createRequire } from 'module';
import { mkdir } from 'fs/promises';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'rb-combined-source-sticks';
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
await page.goto(BASE + '?v=combined-sticks', { waitUntil: 'networkidle0' });

await page.evaluate(async (id) => {
  const img = (() => {
    const c = document.createElement('canvas');
    c.width = 1000; c.height = 750;
    const x = c.getContext('2d');
    x.fillStyle = '#f0ebe3'; x.fillRect(0, 0, 1000, 750);
    x.fillStyle = '#222'; x.fillRect(40, 40, 920, 670);
    return c.toDataURL('image/jpeg', 0.9);
  })();
  await ToolboxDB.putMedia('plan-combined-sticks', img);
  const rec = ToolboxApp.blankCustomerFile(id);
  ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Ryan'; rec.lastName = 'Haddow';
  rec.propertyAddress = '8511 Calle Norte Trail\nFarmington, NM 87402';
  rec.planSetup.canvases = [
    { id: 'cv-plan', name: 'Floor Plan', rooms: [], frontDoorFacing: 'E', frontDoor: null,
      plan: { id: 'plan-combined-sticks', width: 1000, height: 750 } },
  ];
  rec.floorSurvey = {
    id: 'fs-combined-sticks',
    inspectionDate: '2025-11-21',
    byCanvasId: {
      'cv-plan': {
        canvasId: 'cv-plan',
        points: [
          { id: 'm1', x: 150, y: 150, value: 0 },
          { id: 'm2', x: 350, y: 180, value: 1.0 },
          { id: 'g1', x: 700, y: 150, value: 0.8 },
          { id: 'g2', x: 850, y: 200, value: -0.2 },
        ],
        boundary: [
          { x: 40, y: 40 }, { x: 960, y: 40 }, { x: 960, y: 710 }, { x: 40, y: 710 },
        ],
        areas: [
          { id: 'area-main', name: 'Main Floor',
            polygon: [{ x: 40, y: 40 }, { x: 520, y: 40 }, { x: 520, y: 450 }, { x: 40, y: 450 }] },
          { id: 'area-gar', name: '3 Car Garage',
            polygon: [{ x: 520, y: 40 }, { x: 960, y: 40 }, { x: 960, y: 450 }, { x: 520, y: 450 }] },
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

// Corrupt: Combined meta, view on Main Floor (the live "select every time" shape).
await page.evaluate(async (id) => {
  const rec = await ToolboxDB.getCustomerFile(id);
  (rec.reportBuilder.pages || []).forEach((p) => {
    if (!p || p.type !== 'floor' || !p.meta) return;
    if (!/Combined/i.test(String(p.meta.scopeTitle || p.title || ''))) return;
    p.meta.scope = 'all';
    p.meta.areaId = null;
    p.meta.scopeTitle = 'Combined View';
    p.meta.views = [{
      id: 'v0',
      canvasId: 'cv-plan',
      epochId: p.meta.epochId || 'fs-combined-sticks',
      scope: 'area',
      areaId: 'area-main',
      settings: null,
      frame: { x: 0, y: 0, w: 100, h: 100, z: 1 },
    }];
  });
  await ToolboxDB.saveCustomerFile(rec);
}, FILE);

const before = await page.evaluate(async (id) => {
  const rec = await ToolboxDB.getCustomerFile(id);
  const combined = (rec.reportBuilder.pages || []).find((p) =>
    p && p.type === 'floor' && /Combined/i.test(String(p.meta && p.meta.scopeTitle || '')));
  return combined && combined.meta && combined.meta.views && combined.meta.views[0]
    ? { scope: combined.meta.views[0].scope, areaId: combined.meta.views[0].areaId }
    : null;
}, FILE);
check('Corrupt shape stored: Combined view on Main Floor',
  before && before.scope === 'area' && before.areaId === 'area-main',
  JSON.stringify(before));

await page.goto(`${BASE}?v=heal#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => document.querySelector('.rb-shell')?.getAttribute('data-report-ready') === 'true',
  { timeout: 90000 },
);
await page.waitForFunction(async (id) => {
  const rec = await ToolboxDB.getCustomerFile(id);
  const combined = (rec.reportBuilder.pages || []).find((p) =>
    p && p.type === 'floor' && /Combined/i.test(String(p.meta && p.meta.scopeTitle || '')));
  const v = combined && combined.meta && combined.meta.views && combined.meta.views[0];
  return v && v.scope === 'all' && !v.areaId;
}, { timeout: 20000 }, FILE).catch(() => {});
await new Promise((r) => setTimeout(r, 1500));

const healed = await page.evaluate(async (id) => {
  const rec = await ToolboxDB.getCustomerFile(id);
  const combined = (rec.reportBuilder.pages || []).find((p) =>
    p && p.type === 'floor' && /Combined/i.test(String(p.meta && p.meta.scopeTitle || '')));
  return {
    view: combined && combined.meta && combined.meta.views && combined.meta.views[0]
      ? { scope: combined.meta.views[0].scope, areaId: combined.meta.views[0].areaId }
      : null,
    meta: combined ? {
      scope: combined.meta.scope,
      areaId: combined.meta.areaId,
      scopeTitle: combined.meta.scopeTitle,
    } : null,
  };
}, FILE);
check('On open: Combined sole view heals to scope=all (no re-select)',
  healed.view && healed.view.scope === 'all' && !healed.view.areaId,
  JSON.stringify(healed));
check('On open: Combined page meta stays Combined',
  healed.meta && healed.meta.scope === 'all' && !healed.meta.areaId
    && /Combined/i.test(String(healed.meta.scopeTitle || '')),
  JSON.stringify(healed.meta));

// Second reopen — must still be Combined without touching View source.
await page.goto(`${BASE}?v=reopen2#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => document.querySelector('.rb-shell')?.getAttribute('data-report-ready') === 'true',
  { timeout: 90000 },
);
await new Promise((r) => setTimeout(r, 2500));
const again = await page.evaluate(async (id) => {
  const rec = await ToolboxDB.getCustomerFile(id);
  const combined = (rec.reportBuilder.pages || []).find((p) =>
    p && p.type === 'floor' && /Combined/i.test(String(p.meta && p.meta.scopeTitle || '')));
  const v = combined && combined.meta && combined.meta.views && combined.meta.views[0];
  return v ? { scope: v.scope, areaId: v.areaId } : null;
}, FILE);
check('Second reopen: Combined view still Combined',
  again && again.scope === 'all' && !again.areaId,
  JSON.stringify(again));

// Main Floor must not be pulled into Combined by this heal.
const main = await page.evaluate(async (id) => {
  const rec = await ToolboxDB.getCustomerFile(id);
  const p = (rec.reportBuilder.pages || []).find((x) =>
    x && x.type === 'floor' && x.meta && x.meta.scopeTitle === 'Main Floor');
  return p ? {
    scope: p.meta.scope,
    areaId: p.meta.areaId,
    view: p.meta.views && p.meta.views[0]
      ? { scope: p.meta.views[0].scope, areaId: p.meta.views[0].areaId }
      : null,
  } : null;
}, FILE);
check('Main Floor page still Main Floor (not Combined)',
  main && main.scope === 'area' && main.areaId === 'area-main'
    && main.view && main.view.scope === 'area' && main.view.areaId === 'area-main',
  JSON.stringify(main));

check('No page errors', pageErrors.length === 0, pageErrors.join(' | '));
await page.screenshot({ path: `${OUT}/rb-combined-source-sticks.png` }).catch(() => {});
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
