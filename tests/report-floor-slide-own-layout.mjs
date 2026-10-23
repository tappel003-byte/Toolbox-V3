/**
 * One slide can be placed on its own, and say so.
 *
 * Run: node tests/report-floor-slide-own-layout.mjs  (static server on 8765)
 *
 * One record is the rule. A Combined figure is the reason there is an
 * exception: it carries no colour scale and no readings pill -- settled, they
 * go in the rail -- so its left column is free and the plan wants the middle
 * of it rather than a position that clears chrome which is not on the page.
 * Tim: "on the combined view, I would probably put it more towards the
 * middle ... I don't have contours or pills to show."
 *
 * The old bug was never that overrides existed. It was that they were
 * invisible, automatic, and had a factory default sitting behind them, so a
 * slide nobody had touched quietly disagreed with the one that had been
 * arranged. So: a slide goes on its own only because it was put there, it
 * says so while it is, it can be put back, and it falls back to the SHARED
 * record -- never to the factory default.
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
const FILE = 'rb-own-slide';
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
    const pid = 'plan-own-' + i;
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
  rec.floorSurvey = { id: 'fs-own', inspectionDate: '2026-10-09', byCanvasId: byCanvas };
  // An aerial on the cover. Every Floor Survey sheet is handed it, and it is
  // the piece that was not being held across slides -- without one here the
  // fixture could not see the fault at all.
  const aerialId = 'report-cover-overview-own';
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
  await new Promise((r) => setTimeout(r, 1100));
  return true;
}

const near = (a, b, slack = 0.8) => Math.abs(a - b) <= slack;
const samePlace = (a, b) => !!a && !!b && near(a.x, b.x) && near(a.y, b.y);

check('Main Level opens', await openSheet('Floor · Main Level'));
check('the rail offers to place this slide on its own',
  (await railLabels()).some((l) => /place this slide on its own/i.test(l)),
  (await railLabels()).join(' | '));

// Arrange the shared placement first, from Main Level.
await dragBox('legend-0', 210, 130);
const shared = await pieces();

// Take the SECOND slide off the shared placement and move its scale.
check('the Basement sheet opens', await openSheet('Floor · Basement'));
const beforeOwn = await pieces();
check('it is following the shared placement to start with',
  samePlace(shared['legend-0'], beforeOwn['legend-0']),
  JSON.stringify({ shared: shared['legend-0'], here: beforeOwn['legend-0'] }));

await page.evaluate(() => {
  [...document.querySelectorAll('.rb-panel .btn')]
    .find((b) => /place this slide on its own/i.test(b.textContent || '')).click();
});
await new Promise((r) => setTimeout(r, 2000));

check('the slide says it is on its own',
  await page.evaluate(() => [...document.querySelectorAll('.rb-panel .rb-panel__lead')]
    .some((p) => /placed on its own/i.test(p.textContent || ''))),
  '');
check('and offers to put it back',
  (await railLabels()).some((l) => /use the shared placement/i.test(l)),
  (await railLabels()).join(' | '));

const atHandover = await pieces();
check('nothing moved at the moment it was taken off',
  samePlace(beforeOwn['legend-0'], atHandover['legend-0']),
  JSON.stringify({ before: beforeOwn['legend-0'], after: atHandover['legend-0'] }));

await dragBox('legend-0', -180, -70);
const moved = await pieces();
check('moving a piece here moves it', !samePlace(atHandover['legend-0'], moved['legend-0']),
  JSON.stringify({ was: atHandover['legend-0'], now: moved['legend-0'] }));

// The shared slide must NOT have followed it.
check('Main Level opens', await openSheet('Floor · Main Level'));
const mainNow = await pieces();
check('the shared slide did not follow it',
  samePlace(shared['legend-0'], mainNow['legend-0']),
  JSON.stringify({ shared: shared['legend-0'], now: mainNow['legend-0'] }));

// And moving the shared one does not drag the independent slide back.
await dragBox('legend-0', 90, 40);
const mainMoved = await pieces();
check('the Basement sheet opens', await openSheet('Floor · Basement'));
const ownStill = await pieces();
check('and the slide on its own ignored the shared move',
  samePlace(moved['legend-0'], ownStill['legend-0']),
  JSON.stringify({ own: ownStill['legend-0'], sharedMovedTo: mainMoved['legend-0'] }));

// Put it back.
await page.evaluate(() => {
  [...document.querySelectorAll('.rb-panel .btn')]
    .find((b) => /use the shared placement/i.test(b.textContent || '')).click();
});
await new Promise((r) => setTimeout(r, 2000));
const restored = await pieces();
check('putting it back adopts the shared placement again',
  samePlace(mainMoved['legend-0'], restored['legend-0']),
  JSON.stringify({ shared: mainMoved['legend-0'], now: restored['legend-0'] }));

// And nothing of it is left on the Customer File.
await new Promise((r) => setTimeout(r, 2500));
const stored = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const rb = (rec && rec.reportBuilder) || {};
  return { own: (rb.pages || []).filter((p) => p && p.meta && p.meta.ownLayout).length };
}, FILE);
check('and no slide is left holding one', stored.own === 0, JSON.stringify(stored));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
