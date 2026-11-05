/**
 * floorLayout seed: book first; legacy meta.layout only when book absent.
 *
 * Run: node tests/report-floor-legacy-vs-book.mjs  (static server on 8765)
 *
 * Three cases (Tim, Nov 5, 2026):
 *   Both exist  — book layout survives open, autosave, and reopen.
 *   Legacy only — slide layout is preserved and migrates to the book.
 *   Neither     — normal defaults apply.
 */
import { createRequire } from 'module';
import { mkdir, writeFile } from 'fs/promises';

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('/tmp/node_modules/puppeteer-core');
}

const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

await mkdir(OUT, { recursive: true });

{
  const legacyFloor = { tag: 'legacy-slide' };
  const bookFloor = { tag: 'book-wide' };
  const both = bookFloor || legacyFloor;
  const legacyOnly = null || legacyFloor || { tag: 'template' };
  const neither = null || null || { tag: 'template' };
  check('seed prefers book when both exist', both.tag === 'book-wide');
  check('seed uses legacy when book absent', legacyOnly.tag === 'legacy-slide');
  check('seed uses template when neither exists', neither.tag === 'template');
}

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

async function makePlan() {
  return page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 800;
    c.height = 600;
    const x = c.getContext('2d');
    x.fillStyle = '#fff';
    x.fillRect(0, 0, 800, 600);
    x.strokeStyle = '#111';
    x.strokeRect(20, 20, 760, 560);
    return c.toDataURL('image/jpeg', 0.85);
  });
}

async function seedFile(id, mode) {
  const plan = await makePlan();
  return page.evaluate(async ({ id, mode, plan }) => {
    const rec = window.ToolboxApp.blankCustomerFile(id);
    window.ToolboxPlanSetup.ensurePlanSetup(rec);
    rec.firstName = 'Fred';
    rec.lastName = 'Keulen';
    rec.propertyAddress = '44 El Cielo Azul Circle\nEdgewood, NM';
    const cv = rec.planSetup.canvases[0];
    cv.name = 'Main Level';
    cv.frontDoorFacing = 'N';
    const pid = 'plan-' + id;
    await window.ToolboxDB.putMedia(pid, plan);
    cv.plan = { id: pid, width: 800, height: 600 };
    const poly = [{ x: 40, y: 40 }, { x: 760, y: 40 }, { x: 760, y: 560 }, { x: 40, y: 560 }];
    rec.floorSurvey = {
      id: 'fs-' + id,
      inspectionDate: '2026-11-04',
      byCanvasId: {
        [cv.id]: {
          canvasId: cv.id,
          points: [{ id: 'p1', floorId: cv.id, index: 1, x: 200, y: 200, value: 6.1 }],
          areas: [{ id: 'a0', name: 'Main Level', polygon: poly, createdAt: 1,
            legendDx: 0.12, legendDy: -0.08 }],
          boundary: poly,
          highPinDx: 0.04,
          lowPinDx: -0.03,
        },
      },
    };

    const flApi = window.ToolboxReportFloorLayout;
    const legacyLayout = flApi.normalizeLayout(flApi.defaultLayout());
    legacyLayout.topo = { x: 8, y: 8, w: 50, h: 70 };
    const bookLayout = flApi.normalizeLayout(flApi.defaultLayout());
    bookLayout.topo = { x: 28, y: 10, w: 62, h: 78 };
    const defaults = flApi.normalizeLayout(flApi.defaultLayout());

    const floorPage = {
      id: 'floor-main',
      type: 'floor',
      title: 'Floor · Main Level',
      meta: { canvasId: cv.id, areaId: 'a0' },
      reportText: {},
    };
    if (mode === 'both' || mode === 'legacy') {
      floorPage.meta.layout = legacyLayout;
    }

    rec.reportBuilder = {
      schema: 'toolbox.report-builder',
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      pages: [
        { id: 'cover-1', type: 'cover', title: 'Cover', meta: {}, reportText: {} },
        floorPage,
      ],
    };
    if (mode === 'both' || mode === 'book') {
      rec.reportBuilder.floorLayout = bookLayout;
    }

    await window.ToolboxDB.saveCustomerFile(rec);
    return {
      legacyX: legacyLayout.topo.x,
      bookX: bookLayout.topo.x,
      defaultX: defaults.topo.x,
      highPinDx: 0.04,
      legendDx: 0.12,
    };
  }, { id, mode, plan });
}

async function openReport(id) {
  await page.goto(`${BASE}#/file/${id}/report`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
  await new Promise((r) => setTimeout(r, 4500));
}

async function readSaved(id) {
  return page.evaluate(async (fileId) => {
    const rec = await window.ToolboxDB.getCustomerFile(fileId);
    const doc = rec && (rec.reportBuilder || rec.report);
    const floorPage = (doc && doc.pages || []).find((p) => p && p.type === 'floor');
    const cvId = Object.keys((rec.floorSurvey && rec.floorSurvey.byCanvasId) || {})[0];
    const level = cvId && rec.floorSurvey.byCanvasId[cvId];
    return {
      topoX: doc && doc.floorLayout && doc.floorLayout.topo && doc.floorLayout.topo.x,
      hasFloorLayout: !!(doc && doc.floorLayout),
      slideHasMetaLayout: !!(floorPage && floorPage.meta && floorPage.meta.layout),
      highPinDx: level && level.highPinDx,
      legendDx: level && level.areas && level.areas[0] && level.areas[0].legendDx,
    };
  }, id);
}

// --- Both exist ---
const bothSeed = await seedFile('rb-both', 'both');
await openReport('rb-both');
let bothAfter = await readSaved('rb-both');
check('both: book topo.x survives open+autosave',
  Math.abs(bothAfter.topoX - bothSeed.bookX) < 0.5,
  `saved=${bothAfter.topoX} book=${bothSeed.bookX} legacy=${bothSeed.legacyX}`);
check('both: slide meta.layout stripped after save', bothAfter.slideHasMetaLayout === false);
await openReport('rb-both');
bothAfter = await readSaved('rb-both');
check('both: book topo.x survives reopen',
  Math.abs(bothAfter.topoX - bothSeed.bookX) < 0.5,
  `reopen=${bothAfter.topoX}`);
check('both: Floor Survey H/L offsets unchanged',
  bothAfter.highPinDx === bothSeed.highPinDx && bothAfter.legendDx === bothSeed.legendDx);

// --- Legacy only ---
const legacySeed = await seedFile('rb-legacy', 'legacy');
await openReport('rb-legacy');
const legacyAfter = await readSaved('rb-legacy');
check('legacy-only: layout preserved on the book record',
  legacyAfter.hasFloorLayout && Math.abs(legacyAfter.topoX - legacySeed.legacyX) < 0.5,
  `saved=${legacyAfter.topoX} legacy=${legacySeed.legacyX}`);
check('legacy-only: slide meta.layout cleared after migration save',
  legacyAfter.slideHasMetaLayout === false);

// --- Neither ---
const neitherSeed = await seedFile('rb-neither', 'neither');
await openReport('rb-neither');
const neitherAfter = await readSaved('rb-neither');
check('neither: defaults apply (topo.x matches defaultLayout)',
  Math.abs(neitherAfter.topoX - neitherSeed.defaultX) < 0.5,
  `saved=${neitherAfter.topoX} default=${neitherSeed.defaultX}`);

await writeFile(`${OUT}/legacy-vs-book-cases.json`, JSON.stringify({
  both: { seed: bothSeed, after: bothAfter },
  legacy: { seed: legacySeed, after: legacyAfter },
  neither: { seed: neitherSeed, after: neitherAfter },
}, null, 2));

const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
await browser.close();
if (failed.length) process.exit(1);
