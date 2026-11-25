/**
 * Print/Present Floor stills for whole-level "legacy" pages (Tim, Nov 24, 2026).
 *
 * Saved reports carried scope:area + areaId:legacy. Prefight accepted that
 * whenever a boundary existed, but compose filters named areas by id and never
 * invents "legacy" when areas[] is non-empty — Main Floor / Garage printed as
 * "Floor Survey level is not available for this slide" while Patio/Combined
 * (true scope:all or empty areas) drew fine.
 *
 * Run: node tests/report-print-legacy-stills.mjs  (static server on 8765)
 */
import { createRequire } from 'module';
import { mkdir } from 'fs/promises';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'rb-print-legacy-stills-fix';
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
await page.goto(BASE + '?v=legacy-stills-fix', { waitUntil: 'networkidle0' });

await page.evaluate(async (id) => {
  const img = (() => {
    const c = document.createElement('canvas');
    c.width = 1000; c.height = 750;
    const x = c.getContext('2d');
    x.fillStyle = '#f0ebe3'; x.fillRect(0, 0, 1000, 750);
    x.fillStyle = '#222'; x.fillRect(80, 60, 840, 630);
    x.fillStyle = '#eee'; x.fillRect(100, 80, 800, 590);
    return c.toDataURL('image/jpeg', 0.9);
  })();
  await ToolboxDB.putMedia('plan-print-legacy-fix', img);
  const rec = ToolboxApp.blankCustomerFile(id);
  ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Ryan'; rec.lastName = 'Haddow';
  rec.propertyAddress = '8511 Calle Norte Trail\nFarmington, NM 87402';
  rec.planSetup.canvases = [
    { id: 'cv-main', name: 'Main Floor', rooms: [], frontDoorFacing: 'E', frontDoor: null,
      plan: { id: 'plan-print-legacy-fix', width: 1000, height: 750 } },
    { id: 'cv-patio', name: 'Covered Patio', rooms: [], frontDoorFacing: 'E', frontDoor: null,
      plan: { id: 'plan-print-legacy-fix', width: 1000, height: 750 } },
    { id: 'cv-gar', name: '3 Car Garage', rooms: [], frontDoorFacing: 'E', frontDoor: null,
      plan: { id: 'plan-print-legacy-fix', width: 1000, height: 750 } },
  ];
  // Enough points inside EACH named area (>=3) and inside the outer boundary.
  const ptsMain = [
    { id: 'l1', x: 150, y: 120, value: 0 },
    { id: 'l2', x: 300, y: 200, value: 1.0 },
    { id: 'l3', x: 400, y: 320, value: -0.5 },
    { id: 'k1', x: 600, y: 120, value: 0.8 },
    { id: 'k2', x: 750, y: 200, value: -0.2 },
    { id: 'k3', x: 850, y: 320, value: 0.4 },
    { id: 'o1', x: 200, y: 500, value: 0.2 },
    { id: 'o2', x: 700, y: 550, value: -0.8 },
  ];
  const ptsWhole = [
    { id: 'p1', x: 200, y: 150, value: 0 },
    { id: 'p2', x: 700, y: 150, value: 1.2 },
    { id: 'p3', x: 700, y: 550, value: -0.8 },
    { id: 'p4', x: 200, y: 550, value: 0.4 },
  ];
  const boundary = [
    { x: 100, y: 80 }, { x: 900, y: 80 }, { x: 900, y: 670 }, { x: 100, y: 670 },
  ];
  rec.floorSurvey = {
    id: 'fs-print-legacy-fix',
    inspectionDate: '2025-11-21',
    byCanvasId: {
      // Named areas on Main — the case where id "legacy" is NOT inventable.
      'cv-main': {
        canvasId: 'cv-main',
        points: ptsMain,
        boundary,
        areas: [
          { id: 'living', name: 'Living',
            polygon: [{ x: 100, y: 80 }, { x: 500, y: 80 }, { x: 500, y: 400 }, { x: 100, y: 400 }] },
          { id: 'kitchen', name: 'Kitchen',
            polygon: [{ x: 500, y: 80 }, { x: 900, y: 80 }, { x: 900, y: 400 }, { x: 500, y: 400 }] },
        ],
      },
      'cv-patio': { canvasId: 'cv-patio', points: ptsWhole, areas: [], boundary },
      'cv-gar': { canvasId: 'cv-gar', points: ptsWhole, areas: [], boundary },
    },
  };
  rec.distress = {
    updatedAt: '2025-11-21T12:00:00.000Z',
    activeCanvasId: 'cv-main',
    pins: [{ id: 'pin-0', canvasId: 'cv-main', x: 0.4, y: 0.4, description: 'crack', photos: [] }],
  };
  await ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => document.querySelector('.rb-shell')?.getAttribute('data-report-ready') === 'true',
  { timeout: 90000 },
);
await new Promise((r) => setTimeout(r, 3500));

// Force stale saved shape: areaId legacy on Patio, Garage, and Main Combined→legacy
// (simulates pre-scope:all reports). Wipe views so they rebuild from meta.
await page.evaluate(async () => {
  const rec = await ToolboxDB.getCustomerFile('rb-print-legacy-stills-fix');
  (rec.reportBuilder.pages || []).forEach((p) => {
    if (!p || p.type !== 'floor' || !p.meta) return;
    delete p.meta.views;
    // Whole-level patio/garage + wrongly-tagged main area pages.
    if (p.meta.canvasId === 'cv-patio' || p.meta.canvasId === 'cv-gar') {
      p.meta.scope = 'area';
      p.meta.areaId = 'legacy';
    }
    // Living / Kitchen wrongly left on legacy after a bad migrate.
    if (p.meta.canvasId === 'cv-main' && p.meta.scope === 'area') {
      p.meta.areaId = 'legacy';
    }
  });
  await ToolboxDB.saveCustomerFile(rec);
});

await page.goto(`${BASE}?v=legacy-reopen#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => document.querySelector('.rb-shell')?.getAttribute('data-report-ready') === 'true',
  { timeout: 90000 },
);
await new Promise((r) => setTimeout(r, 3500));
// Wait for migrate + flush: Living binds to its area; patio/garage leave legacy.
await page.waitForFunction(async () => {
  const rec = await ToolboxDB.getCustomerFile('rb-print-legacy-stills-fix');
  const pages = (rec.reportBuilder && rec.reportBuilder.pages) || [];
  const living = pages.find((p) => p.meta && p.meta.scopeTitle === 'Living');
  const patio = pages.find((p) => p.meta && p.meta.canvasId === 'cv-patio');
  return living && living.meta.areaId === 'living' &&
    patio && patio.meta.scope === 'all' && !patio.meta.areaId;
}, { timeout: 25000 });

const migrated = await page.evaluate(async () => {
  const rec = await ToolboxDB.getCustomerFile('rb-print-legacy-stills-fix');
  // Migration runs on open into working pages; flushSave may have written back.
  return (rec.reportBuilder.pages || [])
    .filter((p) => p.type === 'floor')
    .map((p) => ({
      title: p.title,
      rail: p.railLabel,
      scopeTitle: p.meta && p.meta.scopeTitle,
      scope: p.meta && p.meta.scope,
      areaId: p.meta && p.meta.areaId,
      canvasId: p.meta && p.meta.canvasId,
      view0: p.meta && p.meta.views && p.meta.views[0]
        ? { scope: p.meta.views[0].scope, areaId: p.meta.views[0].areaId }
        : null,
    }));
});

const living = migrated.find((p) => p.scopeTitle === 'Living' || /Living/i.test(p.title || ''));
const kitchen = migrated.find((p) => p.scopeTitle === 'Kitchen' || /Kitchen/i.test(p.title || ''));
const patio = migrated.find((p) => /Covered Patio/i.test(p.title || '') || p.canvasId === 'cv-patio');
const garage = migrated.find((p) => /Garage/i.test(p.title || '') || p.canvasId === 'cv-gar');
const combined = migrated.find((p) => /Combined/i.test(p.scopeTitle || '') || /Combined/i.test(p.title || ''));

check('Living stays a named-area page (not Combined)',
  living && living.scope === 'area' && living.areaId === 'living',
  JSON.stringify(living));
check('Kitchen stays a named-area page (not Combined)',
  kitchen && kitchen.scope === 'area' && kitchen.areaId === 'kitchen',
  JSON.stringify(kitchen));
check('Covered Patio whole-level legacy becomes Combined',
  patio && patio.scope === 'all' && !patio.areaId,
  JSON.stringify(patio));
check('3 Car Garage whole-level legacy becomes Combined',
  garage && garage.scope === 'all' && !garage.areaId,
  JSON.stringify(garage));
check('Combined View page stays Combined',
  !combined || (combined.scope === 'all' && !combined.areaId),
  JSON.stringify(combined));

const present = await page.evaluate(async () => {
  const btn = document.querySelector('#rb-present');
  btn.click();
  const start = Date.now();
  let status = '';
  while (Date.now() - start < 45000) {
    if (document.body.classList.contains('is-presenting')) break;
    const text = document.body.innerText || '';
    const hit = text.match(/(Present|Print) blocked[^\n]*/);
    if (hit) {
      status = hit[0];
      return { ok: false, blocked: true, status };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  const deck = document.querySelector('.rb-print--present');
  if (!deck) return { ok: false, reason: 'no deck' };
  const sheets = [...deck.querySelectorAll('.rb-print__page .rb-sheet')];
  const topo = sheets.map((sheet, i) => {
    if (!sheet.querySelector('.rb-topo-page')) return null;
    const note = sheet.querySelector('.rb-sheet__note')?.textContent || '';
    const still = sheet.querySelector('img.rb-topo-still');
    const label = sheet.getAttribute('aria-label') || '';
    return {
      i,
      label: label.slice(0, 90),
      hasUnavailable: /not available for this slide/i.test(note),
      hasStill: !!(still && still.getAttribute('src')?.startsWith('data:')),
      stillLen: still?.src?.length || 0,
      hasLegend: !!sheet.querySelector('[data-rb-floor-kind="legend"], [data-rb-floor-box^="legend"]'),
      hasPill: !!sheet.querySelector('[data-rb-floor-kind="pill"], [data-rb-floor-box^="pill"]'),
    };
  }).filter(Boolean);

  const byName = (re) => topo.filter((t) => re.test(t.label));
  return {
    ok: true,
    blocked: false,
    topo,
    main: byName(/Main Floor|Living|Kitchen|Combined/i),
    patio: byName(/Covered Patio/i),
    garage: byName(/Garage/i),
    unavailable: topo.filter((t) => t.hasUnavailable),
    missingStill: topo.filter((t) => !t.hasStill),
  };
});

check('Presentation opens (not blocked)',
  present.ok && !present.blocked,
  JSON.stringify(present.status || { topo: present.topo?.length }));

check('No Floor slide shows the unavailable note',
  present.ok && present.unavailable && present.unavailable.length === 0,
  JSON.stringify(present.unavailable));

check('Every Floor slide has a topo still image',
  present.ok && present.missingStill && present.missingStill.length === 0 && present.topo?.length >= 3,
  JSON.stringify(present.missingStill || present.topo));

check('Main Floor family slides have stills',
  present.ok && present.main?.length >= 1 && present.main.every((t) => t.hasStill),
  JSON.stringify(present.main));

check('Covered Patio has a still',
  present.ok && present.patio?.length >= 1 && present.patio.every((t) => t.hasStill),
  JSON.stringify(present.patio));

check('3 Car Garage has a still',
  present.ok && present.garage?.length >= 1 && present.garage.every((t) => t.hasStill),
  JSON.stringify(present.garage));

check('No page errors', pageErrors.length === 0, pageErrors.join(' | '));

await page.screenshot({ path: `${OUT}/rb-print-legacy-stills.png` }).catch(() => {});
await browser.close();

console.log('migrated snapshot', JSON.stringify(migrated));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
