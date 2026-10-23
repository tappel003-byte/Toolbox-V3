/**
 * One layout record for the whole report.
 *
 * Run: node tests/report-floor-one-layout.mjs   (needs a static server on 8765)
 *
 * Where the plan is framed, where the colour scale sits, where the readings
 * sit, where the aerial sits, and how big each is drawn: ONE record, held by
 * the report, read by every Floor Survey slide. Move a piece on any slide and
 * it has moved on all of them.
 *
 * It used to be three places holding one answer -- the slide's own copy, a
 * book copy, and a factory default behind both -- and whichever was found
 * first won. A slide nobody had touched fell through to the default and
 * disagreed with the slide that had been arranged: Main Level with its aerial
 * where it was put, Garage with it back in the factory corner, and a button
 * on both of them reading "Unlock layout". Tim: "What is the point of having
 * a locked layout that doesn\'t lock the layout?" and "If I put the contour
 * map in one place, it needs to live in one place."
 *
 * So there is no lock. There is nothing to pin, because there is only ever
 * one answer to read.
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
const FILE = 'rb-locks';
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
    const pid = 'plan-locks-' + i;
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
  rec.floorSurvey = { id: 'fs-locks', inspectionDate: '2026-10-09', byCanvasId: byCanvas };
  // An aerial on the cover. Every Floor Survey sheet is handed it, and it is
  // the piece that was not being held across slides -- without one here the
  // fixture could not see the fault at all.
  const aerialId = 'report-cover-overview-locks';
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

// Every piece is movable, on every slide. There is no lock to release.
const before = await pieces();
check('the colour scale and the readings are movable',
  before['legend-0'] && before['legend-0'].movable &&
  before['pill-0'] && before['pill-0'].movable,
  JSON.stringify(before));

check('and the rail offers no Lock layout button, because there is nothing to lock',
  !(await railLabels()).some((l) => /lock/i.test(l)),
  (await railLabels()).join(' | '));

// "Use this as my default" sets the starting placement for the NEXT report.
// Inside this one the arrangement is simply the arrangement. The cover's
// copy of the button says so; this one said nothing, so it read as though
// it might do something to the report in front of you.
const floorHints = await page.evaluate(() =>
  [...document.querySelectorAll('.rb-panel .rb-panel__lead')]
    .map((p) => (p.textContent || '').trim()));
check('the default button says what it does',
  floorHints.some((t) => /new reports start/i.test(t)),
  floorHints.join(' | ').slice(0, 160));

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

// Put all four pieces somewhere of their own on Main Level.
await dragBox('legend-0', 250, 120);
await dragBox('pill-0', 180, -70);
await dragBox('overview', 300, -140);

const mainPieces = await pieces();
const mainBoxes = await boxes();
check('the pieces moved on the slide they were dragged on',
  Math.abs(mainPieces['legend-0'].x - before['legend-0'].x) > 2 &&
  Math.abs(mainPieces['pill-0'].x - before['pill-0'].x) > 2,
  JSON.stringify({ was: before, now: mainPieces }));

// The whole point: the next level, untouched, shows the same arrangement.
check('the Basement sheet opens', await openSheet('Floor · Basement'));
const otherPieces = await pieces();
const otherBoxes = await boxes();

const near = (a, b, slack = 0.8) => Math.abs(a - b) <= slack;
const samePlace = (a, b) => !!a && !!b && near(a.x, b.x) && near(a.y, b.y);

check('the colour scale is in the same place on the slide nobody touched',
  samePlace(mainPieces['legend-0'], otherPieces['legend-0']),
  JSON.stringify({ main: mainPieces['legend-0'], other: otherPieces['legend-0'] }));

check('and so are the readings',
  samePlace(mainPieces['pill-0'], otherPieces['pill-0']),
  JSON.stringify({ main: mainPieces['pill-0'], other: otherPieces['pill-0'] }));

check('and so is the aerial',
  samePlace(mainBoxes.overview, otherBoxes.overview),
  JSON.stringify({ main: mainBoxes.overview, other: otherBoxes.overview }));

check('and so is the plan frame',
  samePlace(mainBoxes.topo, otherBoxes.topo),
  JSON.stringify({ main: mainBoxes.topo, other: otherBoxes.topo }));

check('and both slides draw the pieces at the same size',
  mainPieces['legend-0'].transform === otherPieces['legend-0'].transform &&
  mainPieces['pill-0'].transform === otherPieces['pill-0'].transform,
  JSON.stringify({ main: mainPieces['legend-0'].transform, other: otherPieces['legend-0'].transform }));

// Moving it from THIS slide moves it back on the first one. No slide owns it.
await dragBox('legend-0', -200, -60);
const movedHere = await pieces();
check('the Basement sheet opens', await openSheet('Floor · Main Level'));
const backOnMain = await pieces();
check('a move made on the second slide shows on the first',
  samePlace(movedHere['legend-0'], backOnMain['legend-0']),
  JSON.stringify({ basement: movedHere['legend-0'], main: backOnMain['legend-0'] }));

// And one record is what reaches the Customer File -- not a copy per slide.
await new Promise((r) => setTimeout(r, 2500));
const stored = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const rb = (rec && rec.reportBuilder) || {};
  return {
    hasBookLayout: !!(rb.floorLayout && rb.floorLayout.overlays),
    perSlideCopies: (rb.pages || []).filter((p) => p && p.meta && p.meta.layout).length,
    floorPages: (rb.pages || []).filter((p) => p && p.type === 'floor').length,
  };
}, FILE);
check('the report stores one floor layout',
  stored.hasBookLayout, JSON.stringify(stored));
check('and no slide keeps a copy of its own',
  stored.perSlideCopies === 0 && stored.floorPages >= 2, JSON.stringify(stored));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
