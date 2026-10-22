/**
 * One north for the whole report.
 *
 * Run: node tests/report-north-one-rotation.mjs   (static server on 8765)
 *
 * frontDoorFacing is stored per CANVAS and every new canvas defaults to 'S'
 * (js/plan-setup.js). Only the level being worked on ever gets set, so a
 * report drew a different arrow on every drawing of the same building -- Main
 * Level pointing one way, Garage, Combined and Picture Locations another. A
 * building has one front door.
 *
 * And a hand turn of the rose was kept on the SHEET, so turning it on one
 * drawing left every other drawing pointing somewhere else.
 *
 * North is the report's now: seeded from the first drawing in the book, and
 * a turn moves every drawing with it.
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
const FILE = 'rb-north';
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
    const pid = 'plan-north-' + i;
    await window.ToolboxDB.putMedia(pid, plan);
    cv.plan = { id: pid, width: 1200, height: 900 };
    cv.frontDoorFacing = i === 0 ? 'E' : 'S';
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
  rec.floorSurvey = { id: 'fs-north', inspectionDate: '2026-10-09', byCanvasId: byCanvas };
  // An aerial on the cover. Every Floor Survey sheet is handed it, and it is
  // the piece that was not being held across slides -- without one here the
  // fixture could not see the fault at all.
  const aerialId = 'report-cover-overview-north';
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

const rose = () => page.evaluate(() => {
  const g = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) .rb-rail__rose-rot');
  return g ? (g.getAttribute('transform') || '') : '(no rose)';
});

check('Main Level opens', await openSheet('Floor · Main Level'));
const main = await rose();
// Not merely consistent -- RIGHT. The front door of this building faces
// east, and the proven rule (js/building-types.js, front of building drawn
// at the bottom of the plan) makes that 90 degrees. A failed lookup used to
// latch 0 -- due south -- on the first render, before the Customer File was
// in hand, and every drawing in the book kept it.
check('the rose points the way the front door says: east is 90',
  main === 'rotate(90)', main);

check('the Basement sheet opens', await openSheet('Floor · Basement'));
const basement = await rose();
check('the second level points the same way, though its canvas says otherwise',
  basement === main, JSON.stringify({ main, basement }));

// Turn it on one drawing. Every drawing turns.
check('back to Main Level', await openSheet('Floor · Main Level'));
const turned = await page.evaluate(() => {
  const compass = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) .rb-rail__compass');
  const r = compass.querySelector('.rb-rail__rose').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
});
await page.mouse.move(turned.x, turned.y - turned.w * 0.4);
await page.mouse.down();
await page.mouse.move(turned.x + turned.w * 0.4, turned.y, { steps: 10 });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 1200));
const afterTurn = await rose();
check('turning the rose turns it', afterTurn !== main, JSON.stringify({ main, afterTurn }));

check('the Basement sheet opens', await openSheet('Floor · Basement'));
check('and every other drawing turned with it',
  (await rose()) === afterTurn, JSON.stringify({ afterTurn, basement: await rose() }));

// It is the report's, so it survives a reopen.
await page.waitForFunction(
  () => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''),
  { timeout: 20000 });
const stored = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const rb = (rec && rec.reportBuilder) || {};
  return {
    north: rb.northRotation,
    onSheets: (rb.pages || []).filter((p) => p && p.meta
      && typeof p.meta.northRotation === 'number').length,
  };
}, FILE);
check('the report stores one north', typeof stored.north === 'number', JSON.stringify(stored));
check('and no sheet keeps a turn of its own', stored.onSheets === 0, JSON.stringify(stored));

await page.goto(`${BASE}#/`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 800));
await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 7000));
check('Main Level opens again', await openSheet('Floor · Main Level'));
check('and the turn survived the reopen', (await rose()) === afterTurn,
  JSON.stringify({ afterTurn, now: await rose() }));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
