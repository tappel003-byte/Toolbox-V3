/**
 * The printed figure uses the flooring correction the screen uses.
 *
 * Run: node tests/report-print-corrected-readings.mjs  (static server on 8765)
 *
 * A doorway between two floor coverings carries a correction: every reading
 * on the far side is shifted so the whole level is expressed in one frame.
 * ReportTopoWorkspace hands TopoTab withCorrectedValues(points, ...) and the
 * slide draws THAT.
 *
 * composeReportTopoFigureForPage -- the path that paints the still the PRINTED
 * sheet uses -- read the layer's stored points straight off the Customer File
 * and drew them raw. So a report that says "Corrected for flooring
 * differences" across the top printed an UNCORRECTED survey: different
 * contours, different readings, and a rail beside it still showing the
 * corrected high and low. The sheet contradicted itself, and the numbers that
 * went to the customer were the wrong ones.
 *
 * On the tile-to-carpet step below (1.5 in) the slide reads High 10.3 /
 * Difference 3.3; before the fix the composed figure read 9.0 / 2.0.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'rb-corrected';
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
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.setViewport({ width: 1700, height: 1050, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

await page.evaluate(async (id) => {
  const plan = (() => {
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 900;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 1200, 900);
    x.strokeStyle = '#111'; x.lineWidth = 6; x.strokeRect(30, 30, 1140, 840);
    return c.toDataURL('image/jpeg', 0.92);
  })();
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Corrected'; rec.lastName = 'Readings';
  rec.propertyAddress = '15 Rabbitbrush\nSanta Fe County, NM 87506';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Main Level';
  await window.ToolboxDB.putMedia('plan-corrected', plan);
  cv.plan = { id: 'plan-corrected', width: 1200, height: 900 };
  cv.frontDoorFacing = 'E';
  const poly = [{ x: 40, y: 40 }, { x: 1160, y: 40 }, { x: 1160, y: 860 }, { x: 40, y: 860 }];
  // One doorway: tile on the reference side, carpet on the other, 1.5 in apart.
  const transition = {
    id: 't1', x: 600, y: 450, surfaceA: 'Tile', surfaceB: 'Carpet',
    readingA: 9.0, readingB: 7.5, createdAt: 1,
  };
  const points = [];
  let n = 0;
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      n += 1;
      points.push({
        id: 'p' + n, floorId: cv.id, index: n,
        x: 120 + c * 300, y: 150 + r * 280, value: 7 + ((n * 9) % 27) / 10,
        // The right half of the level sits on the carpet.
        transitionId: c >= 2 ? 't1' : undefined,
      });
    }
  }
  points.push({
    id: 'anchor', floorId: cv.id, index: n + 1, x: 600, y: 450,
    value: 9.0, transitionId: 't1', isTransitionAnchor: true,
  });
  rec.floorSurvey = {
    id: 'fs-corrected', inspectionDate: '2026-10-09',
    byCanvasId: {
      [cv.id]: {
        canvasId: cv.id, points, transitions: [transition],
        areas: [{ id: 'a0', name: 'Main Level', polygon: poly, createdAt: 1 }],
        boundary: poly,
      },
    },
  };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 7000));
const at = await page.evaluate(() => [...document.querySelectorAll('.rb-thumb')]
  .findIndex((t) => /Main Level/i.test((t.querySelector('.rb-thumb__caption') || {}).textContent || '')));
check('the job made a Main Level sheet', at >= 0, String(at));
await page.evaluate((n) => document.querySelectorAll('.rb-thumb')[n].click(), at);
await new Promise((r) => setTimeout(r, 5000));

// What the slide says, off the live drawing.
const onScreen = await page.evaluate(() => {
  const rail = document.querySelector('.rb-stage .rb-sheet .rb-rail__rail');
  const t = rail ? (rail.textContent || '').replace(/\s+/g, ' ') : '';
  const hi = t.match(/High\s*([\d.]+)\s*in/);
  const lo = t.match(/Low\s*([\d.]+)\s*in/);
  const d = t.match(/Difference\s*([\d.]+)\s*in/);
  return { hi: hi && Number(hi[1]), lo: lo && Number(lo[1]), delta: d && Number(d[1]) };
});
check('the slide applies the correction', onScreen.hi === 10.3 && onScreen.delta === 3.3,
  JSON.stringify(onScreen));

// What the printed figure is composed from.
const composed = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const cv = rec.planSetup.canvases[0];
  const layer = rec.floorSurvey.byCanvasId[cv.id];
  const res = await window.ToolboxFloorSurvey.composeReportTopoFigureForPage(rec, {
    canvasId: cv.id, epochId: (layer && layer.epochId) || '', scope: 'all',
  }, (mid) => window.ToolboxDB.getMedia(mid));
  const list = (res && res.stats) || [];
  const arr = Array.isArray(list) ? list : [list];
  return arr.map((s) => s && { name: s.name, hi: s.hi, lo: s.lo, delta: s.delta });
}, FILE);

const first = composed[0] || {};
const round = (v) => Math.round(Number(v) * 100) / 100;
check('and so does the printed figure',
  round(first.hi) === onScreen.hi && round(first.lo) === onScreen.lo
    && round(first.delta) === onScreen.delta,
  JSON.stringify({ screen: onScreen, printed: first }));

// The exact fault, named: the uncorrected numbers must not be what prints.
check('the printed figure is not the uncorrected survey',
  round(first.hi) !== 9 || round(first.delta) !== 2,
  JSON.stringify(first));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
