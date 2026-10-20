/**
 * Two boundaries on one Floor Survey sheet: each colour scale keeps its own
 * readings, and both stay on the paper.
 * Run: node tests/report-floor-two-boundaries.mjs   (needs a static server on 8765)
 *
 * The slots were guessed at "about 21.6% of the page tall". A colour scale is
 * really 31.7% — the stylesheet draws it as a share of the sheet's WIDTH, and
 * an 11 x 17 sheet is 17/11 wider than it is tall. So the pill, dropped 23%,
 * landed INSIDE its own scale, and the next boundary started 31% down, before
 * the one above it had ended. Measured on a two-boundary sheet before the fix:
 * scale 0 from 13 to 44.7 with its pill at 36, scale 1 starting at 44.
 *
 * Tim, on his own job: "the pen and the contour legends are not right... the
 * pill size, the legend, the map, they all should be able to line up exactly."
 */
import { createRequire } from 'module';
import { mkdir } from 'fs/promises';

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('/tmp/node_modules/puppeteer-core');
}

const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
const FILE = 'rb-two-boundaries';
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
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.setViewport({ width: 1700, height: 1050, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

// One level, two surfaces: the house and a garage sloped to drain — the shape
// of job that puts two colour scales on one sheet.
await page.evaluate(async (id) => {
  const c = document.createElement('canvas');
  c.width = 1200;
  c.height = 900;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, 1200, 900);
  x.strokeStyle = '#111';
  x.lineWidth = 6;
  x.strokeRect(50, 50, 1100, 800);
  await window.ToolboxDB.putMedia('plan-two', c.toDataURL('image/jpeg', 0.9));

  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Janis';
  rec.lastName = 'Fensterer';
  rec.propertyAddress = '15 Rabbitbrush\nSanta Fe County, NM 87506';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Main Level';
  cv.plan = { id: 'plan-two', width: 1200, height: 900 };
  cv.frontDoorFacing = 'N';
  const house = [{ x: 60, y: 60 }, { x: 760, y: 60 }, { x: 760, y: 840 }, { x: 60, y: 840 }];
  const garage = [{ x: 800, y: 420 }, { x: 1140, y: 420 }, { x: 1140, y: 840 }, { x: 800, y: 840 }];
  const points = [];
  let n = 0;
  for (let r = 0; r < 4; r += 1) {
    for (let col = 0; col < 3; col += 1) {
      n += 1;
      points.push({ id: 'h' + n, floorId: cv.id, index: n,
        x: 140 + col * 220, y: 160 + r * 190, value: 7 + ((n * 7) % 25) / 10 });
    }
  }
  for (let r = 0; r < 2; r += 1) {
    for (let col = 0; col < 2; col += 1) {
      n += 1;
      points.push({ id: 'g' + n, floorId: cv.id, index: n,
        x: 880 + col * 160, y: 520 + r * 180, value: 5.3 + ((n * 3) % 30) / 10 });
    }
  }
  rec.floorSurvey = { id: 'fs-two', inspectionDate: '2026-10-09', byCanvasId: {
    [cv.id]: { canvasId: cv.id, points,
      areas: [{ id: 'a-house', name: 'Main Level', polygon: house, createdAt: 1 },
        { id: 'a-garage', name: 'Garage', polygon: garage, createdAt: 2 }],
      boundary: house } } };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

async function openCombined() {
  await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
  await new Promise((r) => setTimeout(r, 5000));
  // The caption alone. A thumb's full text includes the cover's CONTENTS,
  // which lists every figure in the book -- so matching on it picks the cover
  // whatever is being looked for.
  const at = await page.evaluate(() => [...document.querySelectorAll('.rb-thumb')]
    .findIndex((t) => /Combined/i.test(
      (t.querySelector('.rb-thumb__caption') || {}).textContent || '')));
  await page.evaluate((n) => document.querySelectorAll('.rb-thumb')[n < 0 ? 2 : n].click(), at);
  await page.waitForFunction(
    () => document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-box^="legend"]').length >= 2,
    { timeout: 25000 },
  ).catch(() => {});
  await new Promise((r) => setTimeout(r, 2500));
}

/** Every scale and pill, as a share of the sheet they are drawn on. */
const pieces = () => page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
  const stage = sheet.querySelector('[data-rb-floor-stage]') || sheet;
  const sr = stage.getBoundingClientRect();
  const out = {};
  sheet.querySelectorAll('[data-rb-floor-box]').forEach((el) => {
    const id = el.getAttribute('data-rb-floor-box');
    if (!/^legend|^pill/.test(id)) return;
    const r = el.getBoundingClientRect();
    out[id] = {
      x: +(((r.left - sr.left) / sr.width) * 100).toFixed(1),
      top: +(((r.top - sr.top) / sr.height) * 100).toFixed(1),
      bottom: +(((r.bottom - sr.top) / sr.height) * 100).toFixed(1),
    };
  });
  return out;
});

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 4000));

// The slots themselves, asked of the module rather than hunted for on a
// rendered sheet: two boundaries, and where each one's scale and pill land.
const laid = await page.evaluate(() => {
  const api = window.ToolboxReportFloorLayout;
  const layout = api.layoutForStats(api.defaultLayout(), 2, [{}, {}]);
  const at = (id) => layout.overlays.find((o) => o.id === id) || null;
  // A colour scale is 20.5cqw tall, and cqw is a share of the sheet's WIDTH;
  // an 11 x 17 sheet is 17/11 wider than tall, so it is this much of the
  // height. The old slots were built on a guess of "about 21.6%".
  const scaleTall = 20.5 * (17 / 11);
  return {
    scale0: at('legend-0'), pill0: at('pill-0'),
    scale1: at('legend-1'), pill1: at('pill-1'),
    scaleTall: +scaleTall.toFixed(1),
  };
});

check('a two-boundary sheet lays out both colour scales and both readings',
  !!laid.scale0 && !!laid.scale1 && !!laid.pill0 && !!laid.pill1,
  JSON.stringify(laid));

check('each boundary\'s readings sit under its own scale, clear of it',
  laid.pill0.y > laid.scale0.y + laid.scaleTall &&
  laid.pill1.y > laid.scale1.y + laid.scaleTall,
  JSON.stringify({ scaleTall: laid.scaleTall, scale0: laid.scale0.y, pill0: laid.pill0.y,
    scale1: laid.scale1.y, pill1: laid.pill1.y }));

check('the second pair starts below the first, not on top of it',
  laid.scale1.y > laid.pill0.y,
  JSON.stringify({ firstPill: laid.pill0.y, secondScale: laid.scale1.y }));

check('and the second scale still ends on the paper',
  laid.scale1.y + laid.scaleTall <= 92 && laid.pill1.y <= 92,
  JSON.stringify({ secondScaleEnds: +(laid.scale1.y + laid.scaleTall).toFixed(1), pill1: laid.pill1.y }));

// A report saved under the old overlapping slots carries those positions for
// ever: normalizeLayout keeps what is stored. A position nobody chose is not
// his, so it takes the corrected slot; a position he dragged to is his and is
// left exactly where it is. The same repair the cover's identity box uses.
const repaired = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const doc = rec.reportBuilder || rec.report;
  const floor = (doc.pages || []).find((p) => p.type === 'floor' && p.meta && p.meta.layout);
  const api = window.ToolboxReportFloorLayout;
  // Exactly the old defaults for boundary 0 and 1 — never touched by hand.
  const stale = api.normalizeLayout({
    locked: false,
    topo: floor.meta.layout.topo,
    overview: floor.meta.layout.overview,
    overlays: [
      { id: 'legend-0', kind: 'legend', statsIndex: 0, x: 8, y: 13, scale: 1 },
      { id: 'pill-0', kind: 'pill', statsIndex: 0, x: 8, y: 36, scale: 1 },
      { id: 'legend-1', kind: 'legend', statsIndex: 1, x: 8, y: 44, scale: 1 },
      { id: 'pill-1', kind: 'pill', statsIndex: 1, x: 8, y: 67, scale: 1 },
    ],
  });
  // And one the investigator plainly dragged somewhere of his own.
  const dragged = api.normalizeLayout({
    locked: false,
    topo: floor.meta.layout.topo,
    overview: floor.meta.layout.overview,
    overlays: [{ id: 'legend-0', kind: 'legend', statsIndex: 0, x: 61.5, y: 20.25, scale: 1 }],
  });
  const find = (layout, id) => layout.overlays.find((o) => o.id === id) || null;
  return {
    staleScale0: find(stale, 'legend-0'),
    stalePill0: find(stale, 'pill-0'),
    staleScale1: find(stale, 'legend-1'),
    draggedScale0: find(dragged, 'legend-0'),
  };
}, FILE);

check('a report saved on the old slots takes the corrected ones',
  repaired.stalePill0.y > repaired.staleScale0.y + 31 &&
  repaired.staleScale1.y > repaired.stalePill0.y,
  JSON.stringify(repaired));

check('and a position the investigator chose is left exactly alone',
  repaired.draggedScale0.x === 61.5 && repaired.draggedScale0.y === 20.25,
  JSON.stringify(repaired.draggedScale0));

await page.screenshot({ path: `${OUT}/report-floor-two-boundaries.png` });
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
