/**
 * Auto-import must keep Floor slides on the live host even when one-shot
 * compose PNG fails (Tim, Nov 23, 2026 — Import stubs on real jobs).
 *
 * Also: a whole-level legacy boundary uses the level name, not "Boundary 1".
 *
 * Run: node tests/report-floor-auto-import-live.mjs  (static server on 8765)
 */
import { createRequire } from 'module';
import { mkdir } from 'fs/promises';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'rb-floor-auto-live';
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
await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

await page.evaluate(async (id) => {
  const img = (() => {
    const c = document.createElement('canvas');
    c.width = 800; c.height = 600;
    const x = c.getContext('2d');
    x.fillStyle = '#f0ebe3'; x.fillRect(0, 0, 800, 600);
    x.fillStyle = '#222'; x.fillRect(120, 90, 560, 420);
    return c.toDataURL('image/jpeg', 0.9);
  })();
  await ToolboxDB.putMedia('plan-auto-live', img);
  const rec = ToolboxApp.blankCustomerFile(id);
  ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Ryan'; rec.lastName = 'Haddow';
  rec.propertyAddress = '8511 Calle Norte Trail\nFarmington, NM 87402';
  const names = ['Main Floor', 'Covered Patio', 'Garage'];
  rec.planSetup.canvases = names.map((name, i) => ({
    id: 'cv-' + i, name, rooms: [], frontDoorFacing: 'E', frontDoor: null,
    plan: { id: 'plan-auto-live', width: 800, height: 600 },
  }));
  rec.floorSurvey = { id: 'fs-auto', inspectionDate: '2025-11-21', byCanvasId: {} };
  rec.planSetup.canvases.forEach((cv, i) => {
    const areas = i === 0 ? [
      { id: 'a1', name: 'Living', polygon: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.5, y: 0.5 }, { x: 0.1, y: 0.5 }] },
      { id: 'a2', name: 'Kitchen', polygon: [{ x: 0.5, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.5 }, { x: 0.5, y: 0.5 }] },
    ] : [];
    rec.floorSurvey.byCanvasId[cv.id] = {
      canvasId: cv.id,
      points: [
        { id: 'p1', x: 200, y: 150, value: 0 },
        { id: 'p2', x: 500, y: 400, value: -1.2 },
      ],
      areas,
      boundary: [{ x: 100, y: 80 }, { x: 700, y: 80 }, { x: 700, y: 520 }, { x: 100, y: 520 }],
    };
  });
  rec.distress = {
    updatedAt: '2025-11-21T12:00:00.000Z',
    activeCanvasId: 'cv-0',
    pins: [{ id: 'pin-0', canvasId: 'cv-0', x: 0.4, y: 0.4, description: 'crack', photos: [] }],
  };
  await ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => document.querySelector('.rb-shell')?.getAttribute('data-report-ready') === 'true',
  { timeout: 90000 },
);
await new Promise((r) => setTimeout(r, 4500));

const rail = await page.evaluate(() =>
  [...document.querySelectorAll('.rb-thumb__caption')].map((n) => n.textContent));
check('Rail does not list generic Boundary 1 for whole levels',
  !rail.some((t) => t === 'Floor · Boundary 1'),
  rail.filter((t) => /^Floor/.test(t)).join(' | '));
check('Covered Patio / Garage use level names in the rail',
  rail.includes('Floor · Covered Patio') && rail.includes('Floor · Garage'),
  rail.filter((t) => /^Floor/.test(t)).join(' | '));

const floors = await page.evaluate(async () => {
  const out = [];
  for (const t of [...document.querySelectorAll('.rb-thumb')]) {
    const cap = t.querySelector('.rb-thumb__caption')?.textContent || '';
    if (!/^Floor/.test(cap)) continue;
    t.click();
    await new Promise((r) => setTimeout(r, 700));
    const stage = document.querySelector('.rb-stage');
    out.push({
      cap,
      import: !!stage.querySelector('[data-rb-floor-import]'),
      empty: !!stage.querySelector('.rb-floor-empty'),
      live: !!stage.querySelector('.rb-topo-page__drawing--live'),
      importedClass: !!stage.querySelector('.rb-topo-page--imported'),
    });
  }
  return out;
});

const stubs = floors.filter((f) => f.import || f.empty);
const live = floors.filter((f) => f.live || f.importedClass);
check('Every Floor slide auto-imports (no Import stub)',
  stubs.length === 0 && floors.length >= 3,
  JSON.stringify(floors));
check('Floor slides mount the live drawing host',
  live.length === floors.length,
  JSON.stringify(floors));

// Stage CONTENTS only — no duplicate Discussion / figure lines
await page.evaluate(() => document.querySelector('.rb-thumb')?.click());
await new Promise((r) => setTimeout(r, 500));
const toc = await page.evaluate(() => {
  const items = [...document.querySelector('.rb-stage')?.querySelectorAll('.rb-cover__contents-item') || []]
    .map((r) => (r.querySelector('.rb-cover__contents-field')?.textContent || '').trim());
  const counts = {};
  items.forEach((t) => { counts[t] = (counts[t] || 0) + 1; });
  return { items, dups: Object.entries(counts).filter(([, n]) => n > 1) };
});
check('Stage CONTENTS has no duplicated lines',
  toc.dups.length === 0,
  JSON.stringify(toc));

check('No page errors', pageErrors.length === 0, pageErrors.join(' | '));

await page.screenshot({ path: `${OUT}/rb-floor-auto-import-live.png` }).catch(() => {});
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
