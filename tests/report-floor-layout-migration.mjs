/**
 * An older report keeps the arrangement it was given.
 *
 * Run: node tests/report-floor-layout-migration.mjs  (static server on 8765)
 *
 * Before there was one record, a Floor Survey slide kept its own copy of the
 * layout and the renderer read that copy BEFORE the book's. So a report
 * arranged under the old model has the real placement on the SLIDES, and the
 * book's copy may be stale. Opening it under one record has to adopt the
 * slide's copy; reading the book's would throw the arrangement away and put
 * the aerial and the chrome back where the factory had them.
 *
 * And the size has to come from the record too. With nothing stored, the
 * colour scale falls back to the slide's own Legend size setting -- so two
 * slides whose settings differ draw the same piece at two sizes, which is the
 * same drift by another road.
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
const FILE = 'rb-migrate';
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

// Two levels, each one boundary, so there are two sheets carrying a colour
// scale and a pill -- which is what a lock has to make agree.
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
  const names = ['Main Level', 'Basement'];
  rec.planSetup.canvases[0].name = names[0];
  rec.planSetup.canvases.push(window.ToolboxPlanSetup.blankCanvas(names[1]));
  const poly = [{ x: 60, y: 60 }, { x: 1140, y: 60 }, { x: 1140, y: 840 }, { x: 60, y: 840 }];
  const byCanvas = {};
  for (let i = 0; i < rec.planSetup.canvases.length; i += 1) {
    const cv = rec.planSetup.canvases[i];
    cv.name = names[i];
    const pid = 'plan-migrate-' + i;
    await window.ToolboxDB.putMedia(pid, plan);
    cv.plan = { id: pid, width: 1200, height: 900 };
    cv.frontDoorFacing = 'N';
    const points = [];
    let n = 0;
    for (let r = 0; r < 3; r += 1) {
      for (let c = 0; c < 4; c += 1) {
        n += 1;
        points.push({ id: 'p' + i + '_' + n, floorId: cv.id, index: n,
          x: 180 + c * 250, y: 200 + r * 220, value: 7 + ((n * 9) % 27) / 10 });
      }
    }
    byCanvas[cv.id] = { canvasId: cv.id, points,
      areas: [{ id: 'a' + i, name: names[i], polygon: poly, createdAt: 1 }], boundary: poly };
  }
  rec.floorSurvey = { id: 'fs-migrate', inspectionDate: '2026-10-09', byCanvasId: byCanvas };
  // An aerial on the cover. Every Floor Survey sheet is handed it, and it is
  // the piece that was not being held across slides -- without one here the
  // fixture could not see the fault at all.
  const aerialId = 'report-cover-overview-migrate';
  await window.ToolboxDB.putMedia(aerialId, plan);
  rec.reportBuilder = rec.reportBuilder || {};
  rec.reportBuilder.coverLayout = rec.reportBuilder.coverLayout || {};
  rec.reportBuilder.coverLayout.overviewMediaId = aerialId;
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 7000));

async function openSheet(match) {
  const at = await page.evaluate((m) => [...document.querySelectorAll('.rb-thumb')]
    .findIndex((t) => new RegExp(m, 'i')
      .test((t.querySelector('.rb-thumb__caption') || {}).textContent || '')), match);
  if (at < 0) return false;
  await page.evaluate((n) => document.querySelectorAll('.rb-thumb')[n].click(), at);
  await new Promise((r) => setTimeout(r, 3500));
  return true;
}

check('the job made a Main Level sheet', await openSheet('Floor · Main Level'));

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
      y: +(((r.top - sr.top) / sr.height) * 100).toFixed(1),
      transform: getComputedStyle(el).transform,
      movable: el.getAttribute('tabindex') === '0',
    };
  });
  return out;
});

// The plan frame and the aerial, as a share of the sheet.
const boxes = () => page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
  const sr = sheet.getBoundingClientRect();
  const out = {};
  sheet.querySelectorAll('[data-rb-floor-box]').forEach((el) => {
    const id = el.getAttribute('data-rb-floor-box');
    if (!/^overview$|^topo$/.test(id)) return;
    const r = el.getBoundingClientRect();
    out[id] = {
      x: +(((r.left - sr.left) / sr.width) * 100).toFixed(1),
      y: +(((r.top - sr.top) / sr.height) * 100).toFixed(1),
      w: +((r.width / sr.width) * 100).toFixed(1),
      h: +((r.height / sr.height) * 100).toFixed(1),
    };
  });
  return out;
});

// Every button in the Floor Survey rail, wherever in it they sit.
const railLabels = () => page.evaluate(() =>
  [...document.querySelectorAll('.rb-panel .btn')]
    .map((b) => (b.textContent || '').trim()).filter(Boolean));

// Arrange everything on Main Level, then force the report back into the
// shape an older build saved: the placement on the slides, the book's copy
// stale, and the slides carrying different Legend size settings.
async function dragBox(id, dx, dy) {
  const at = await page.evaluate((box) => {
    const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
    const el = sheet.querySelector('[data-rb-floor-box="' + box + '"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, id);
  if (!at) return false;
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + dx, at.y + dy, { steps: 12 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 1200));
  return true;
}

await dragBox('legend-0', 230, 150);
await dragBox('overview', 280, -150);
const arranged = { pieces: await pieces(), boxes: await boxes() };
await page.waitForFunction(
  () => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''),
  { timeout: 20000 });

const rewritten = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const rb = rec.reportBuilder;
  const arrangedLayout = JSON.parse(JSON.stringify(rb.floorLayout));
  // The old shape: every floor slide carries the copy, the book keeps a
  // stale one, and each slide has its own Legend size.
  let n = 0;
  (rb.pages || []).forEach((p) => {
    if (!p || p.type !== 'floor') return;
    n += 1;
    p.meta = p.meta || {};
    p.meta.layout = JSON.parse(JSON.stringify(arrangedLayout));
    p.meta.floorView = Object.assign({}, p.meta.floorView || {}, { legendScale: n === 1 ? 1 : 1.6 });
  });
  rb.floorLayout = window.ToolboxReportFloorLayout.defaultLayout();
  await window.ToolboxDB.saveCustomerFile(rec);
  return { floorPages: n, bookIsDefault: true };
}, FILE);
check('the fixture was put back into the older shape',
  rewritten.floorPages >= 2, JSON.stringify(rewritten));

// Open it again, as the investigator would.
await page.goto(`${BASE}#/`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 800));
await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 7000));

check('the Main Level sheet opens', await openSheet('Floor · Main Level'));
const reopened = { pieces: await pieces(), boxes: await boxes() };

const near = (a, b, slack = 1.2) => Math.abs(a - b) <= slack;
const samePlace = (a, b) => !!a && !!b && near(a.x, b.x) && near(a.y, b.y);

check('the arrangement it was given survived the open',
  samePlace(arranged.pieces['legend-0'], reopened.pieces['legend-0']) &&
  samePlace(arranged.boxes.overview, reopened.boxes.overview),
  JSON.stringify({ was: arranged, now: reopened }));

check('and it was not replaced by the factory corner',
  Math.abs(reopened.boxes.overview.x - 2.5) > 3 ||
  Math.abs(reopened.boxes.overview.y - 74) > 3,
  JSON.stringify(reopened.boxes.overview));

// The second level had a different Legend size saved on it. It must not
// draw the colour scale at that size -- the record's size is the size.
check('the Basement sheet opens', await openSheet('Floor · Basement'));
const other = { pieces: await pieces(), boxes: await boxes() };

check('the second level took the arrangement too',
  samePlace(reopened.pieces['legend-0'], other.pieces['legend-0']) &&
  samePlace(reopened.boxes.overview, other.boxes.overview),
  JSON.stringify({ main: reopened, other: other }));

check('and draws the colour scale at the same size, not at its own Legend size',
  reopened.pieces['legend-0'].transform === other.pieces['legend-0'].transform,
  JSON.stringify({ main: reopened.pieces['legend-0'].transform,
    other: other.pieces['legend-0'].transform }));

// And the per-slide copies are gone once it saves again.
await new Promise((r) => setTimeout(r, 2500));
const after = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const rb = (rec && rec.reportBuilder) || {};
  return {
    copies: (rb.pages || []).filter((p) => p && p.meta && p.meta.layout).length,
    legendScale: rb.floorLayout && rb.floorLayout.legendLock && rb.floorLayout.legendLock.scale,
    pillScale: rb.floorLayout && rb.floorLayout.pillLock && rb.floorLayout.pillLock.scale,
  };
}, FILE);
check('no slide keeps a copy once it is saved again', after.copies === 0, JSON.stringify(after));
check('and the record holds a size for both pieces',
  Number(after.legendScale) > 0 && Number(after.pillScale) > 0, JSON.stringify(after));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
