/**
 * How a level's sheets arrive, and what the combined one carries.
 * Run: node tests/report-floor-combined-order.mjs   (needs a static server on 8765)
 *
 * Three decisions Tim made on Oct 20, all about a report opening already
 * built rather than needing to be rearranged:
 *
 *  - "Main level always gets brought in first." It used to come in whatever
 *    order the canvases happened to be created, so a basement could open the
 *    report.
 *  - "We bring any floor level survey that has all levels lastly, and we just
 *    say combined view" -- he took "for exhibit" back the same day: "I don't
 *    think it sounds good." The everything-at-once sheet used to LEAD
 *    its level, so the busiest drawing in the book was the first one seen.
 *  - "Whenever we bring in different levels with multiple topos, we do not
 *    bring in the pill, high-low delta pill. We do not bring in the contour
 *    legend." Several boundaries meant several colour scales and several
 *    pills stacked down the margin, each reading a surface the eye cannot
 *    pick out of a combined drawing.
 *
 * And the garage: "I just want data points in the garage. Period. I can
 * always change them later." It opens on Points only; the rail's own
 * rendition control still changes it.
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
const FILE = 'rb-combined-order';
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

// A job shaped like his: the basement drawn first, the main floor second with
// two surfaces on it, and a garage slab.
await page.evaluate(async (id) => {
  const plan = (() => {
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 900;
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, 1200, 900);
    x.strokeStyle = '#111';
    x.lineWidth = 6;
    x.strokeRect(50, 50, 1100, 800);
    return c.toDataURL('image/jpeg', 0.9);
  })();

  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Janis';
  rec.lastName = 'Fensterer';
  rec.propertyAddress = '15 Rabbitbrush\nSanta Fe County, NM 87506';

  // Deliberately out of report order: Basement is canvas 0.
  const names = ['Basement', 'Main Level', 'Garage'];
  rec.planSetup.canvases[0].name = names[0];
  for (let i = 1; i < names.length; i += 1) {
    rec.planSetup.canvases.push(window.ToolboxPlanSetup.blankCanvas(names[i]));
  }

  const whole = [{ x: 60, y: 60 }, { x: 1140, y: 60 }, { x: 1140, y: 840 }, { x: 60, y: 840 }];
  const left = [{ x: 60, y: 60 }, { x: 600, y: 60 }, { x: 600, y: 840 }, { x: 60, y: 840 }];
  const right = [{ x: 640, y: 60 }, { x: 1140, y: 60 }, { x: 1140, y: 840 }, { x: 640, y: 840 }];
  const byCanvas = {};
  for (let i = 0; i < rec.planSetup.canvases.length; i += 1) {
    const cv = rec.planSetup.canvases[i];
    cv.name = names[i];
    const planId = 'plan-' + id + '-' + i;
    await window.ToolboxDB.putMedia(planId, plan);
    cv.plan = { id: planId, width: 1200, height: 900 };
    cv.frontDoorFacing = 'N';
    const points = [];
    let n = 0;
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        n += 1;
        points.push({ id: 'p' + i + '_' + n, floorId: cv.id, index: n,
          x: 160 + col * 260, y: 180 + row * 230, value: 7 + ((n * 7) % 25) / 10 });
      }
    }
    // Only the main floor has two surfaces, so only it gets a combined sheet.
    const areas = names[i] === 'Main Level'
      ? [{ id: 'a' + i + '-l', name: 'Living Area', polygon: left, createdAt: 1 },
         { id: 'a' + i + '-r', name: 'Sunken Room', polygon: right, createdAt: 2 }]
      : [{ id: 'a' + i, name: names[i], polygon: whole, createdAt: 1 }];
    byCanvas[cv.id] = { canvasId: cv.id, points, areas, boundary: whole };
  }
  rec.floorSurvey = { id: 'fs-order', inspectionDate: '2026-10-09', byCanvasId: byCanvas };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 6000));

const rail = await page.evaluate(() => [...document.querySelectorAll('.rb-thumb')]
  .map((t) => {
    const cap = t.querySelector('.rb-thumb__caption');
    return ((cap ? cap.textContent : t.textContent) || '').replace(/\s+/g, ' ').trim();
  }));
const floorRail = rail.filter((label) => /Floor ·/.test(label));

check('Main Level comes in ahead of the Basement it was drawn after',
  floorRail.findIndex((l) => /Living Area|Sunken Room|Combined/.test(l)) <
  floorRail.findIndex((l) => /Basement/.test(l)),
  JSON.stringify(floorRail));

const combinedAt = floorRail.findIndex((l) => /Combined/.test(l));
check('the combined sheet comes after the boundaries it combines',
  combinedAt > floorRail.findIndex((l) => /Living Area/.test(l)) &&
  combinedAt > floorRail.findIndex((l) => /Sunken Room/.test(l)),
  JSON.stringify(floorRail));

const titles = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const doc = rec.reportBuilder || rec.report;
  return (doc.pages || []).filter((p) => p.type === 'floor' && p.meta && !p.meta.reserved)
    .map((p) => ({ title: p.title, scope: p.meta.scope, points: !!p.meta.pointsOnly,
      level: p.meta.levelName, mode: (p.meta.floorView || {}).mode || '' }));
}, FILE);

check('and it is named for what it is on an exhibit',
  titles.some((t) => /Combined View/.test(t.title)),
  JSON.stringify(titles.map((t) => t.title)));

check('the garage opens on readings alone',
  titles.filter((t) => /Garage/i.test(t.level)).every((t) => t.points && t.mode === 'points-only'),
  JSON.stringify(titles.filter((t) => /Garage/i.test(t.level))));

check('and no other level was switched to readings alone',
  titles.filter((t) => !/Garage/i.test(t.level)).every((t) => !t.points),
  JSON.stringify(titles.filter((t) => t.points).map((t) => t.level)));

/** Open one sheet by its rail label and report what the page carries. */
async function sheetPieces(match) {
  // The caption, not the whole stamp: the cover's CONTENTS lists every figure
  // in the book, so searching a thumb's text finds the cover every time.
  const at = await page.evaluate((m) => [...document.querySelectorAll('.rb-thumb')]
    .findIndex((t) => {
      const cap = t.querySelector('.rb-thumb__caption');
      return !!cap && new RegExp(m, 'i').test(cap.textContent || '');
    }), match);
  if (at < 0) return null;
  await page.evaluate((n) => document.querySelectorAll('.rb-thumb')[n].click(), at);
  await new Promise((r) => setTimeout(r, 4000));
  return page.evaluate(() => {
    const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
    const ids = [...sheet.querySelectorAll('[data-rb-floor-box]')]
      .map((el) => el.getAttribute('data-rb-floor-box'));
    return {
      legends: ids.filter((i) => /^legend/.test(i)).length,
      pills: ids.filter((i) => /^pill/.test(i)).length,
      topos: ids.filter((i) => /^topo/.test(i)).length,
      imported: !!sheet.querySelector('.rb-topo-page--imported'),
      text: (sheet.textContent || '').replace(/\s+/g, ' ').slice(0, 220),
    };
  });
}

const combined = await sheetPieces('Combined');
check('the combined sheet carries the drawing and neither scale nor readings',
  !!combined && combined.topos >= 1 && combined.legends === 0 && combined.pills === 0,
  JSON.stringify(combined));

// A sheet drawn as readings alone carries no colour scale: there are no
// contour colours on it for a scale to be the key to. The readings stay, and
// take the slot the scale would have had rather than floating mid-drawing.
const garage = await sheetPieces('Garage');
check('the garage sheet keeps its readings and drops the colour scale',
  !!garage && garage.topos >= 1 && garage.legends === 0 && garage.pills === 1,
  JSON.stringify(garage));

const single = await sheetPieces('Sunken Room');
check('a single-boundary sheet still gets its colour scale and its readings',
  !!single && single.legends === 1 && single.pills === 1,
  JSON.stringify(single));

await page.screenshot({ path: `${OUT}/report-floor-combined-order.png` });
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
