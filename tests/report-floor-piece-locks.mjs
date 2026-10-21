/**
 * One Lock layout button on a Floor Survey sheet: it pins the framing and
 * both pieces, where they sit and how big they are drawn.
 * Run: node tests/report-floor-piece-locks.mjs   (needs a static server on 8765)
 *
 * There were two locks before, and neither name said what it did. "Lock view"
 * was only the plan's framing, though it sounded like everything. "Lock
 * layout" moved the colour scale and the readings together and named neither
 * -- and it sat on a toolbar an imported sheet never draws, so there was no
 * way to press it at all.
 *
 * Tim: "lock view doesn't really tell us what we're supposed to do... I might
 * want to lock floor survey, I might want to lock a legend contour and then I
 * might want to lock the high/low delta pin, and all of those can be
 * separate." And what a lock has to cover: "they should all just come in
 * exactly in the same place always, always in the same size."
 *
 * The size matters as much as the place. An unlocked piece is drawn at the
 * rail's own control, which lives on the device -- so the same report on
 * another machine drew it another size. A locked piece carries its size in
 * the report.
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

// Every button in the Floor Survey rail, wherever in it they sit. The locks
// used to be pinned above the controls; they are below them now, because the
// tab strip has to be the first thing in the panel.
const railLabels = () => page.evaluate(() =>
  [...document.querySelectorAll('.rb-panel .btn')]
    .map((b) => (b.textContent || '').trim()).filter(Boolean));

const labels = await railLabels();
// One button, as it was before three replaced it. Tim: "Lock layout is
// better, one button vs three, let's go back to that." What had actually
// broken was that Lock layout drew its button only on a sheet that had not
// been imported, so it could never be pressed -- a missing button, answered
// with two extra states.
check('the rail offers one Lock layout, not three separate locks',
  labels.some((l) => /^Lock layout$/i.test(l)) &&
  !labels.some((l) => /^Lock contour legend$/i.test(l)) &&
  !labels.some((l) => /^Lock high\/low\/delta$/i.test(l)) &&
  !labels.some((l) => /^Lock floor survey$/i.test(l)),
  JSON.stringify(labels));

/** Where and how big each piece is drawn on the open sheet. */
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

// Move the colour scale somewhere of its own on this sheet, then lock it.
const before = await pieces();
const moved = await page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
  const box = sheet.querySelector('[data-rb-floor-box="legend-0"]');
  const r = box.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.mouse.move(moved.x, moved.y);
await page.mouse.down();
await page.mouse.move(moved.x + 260, moved.y + 90, { steps: 12 });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 1200));
const afterDrag = await pieces();
check('an unlocked colour scale still moves',
  Math.abs(afterDrag['legend-0'].x - before['legend-0'].x) > 2,
  JSON.stringify({ was: before['legend-0'], now: afterDrag['legend-0'] }));

await page.evaluate(() => {
  const btn = document.querySelector('[data-rb-floor-lock-all]');
  if (btn) btn.click();
});
await new Promise((r) => setTimeout(r, 2500));

const lockedHere = await pieces();
check('locking it leaves it exactly where it was put',
  Math.abs(lockedHere['legend-0'].x - afterDrag['legend-0'].x) < 0.6 &&
  Math.abs(lockedHere['legend-0'].y - afterDrag['legend-0'].y) < 0.6,
  JSON.stringify({ atLock: afterDrag['legend-0'], now: lockedHere['legend-0'] }));

check('and it can no longer be dragged off that spot',
  lockedHere['legend-0'].movable === false,
  JSON.stringify(lockedHere['legend-0']));

// One lock covers both pieces, which is the simplification: there is no
// state where the scale is pinned and the readings are not.
check('and the readings are held by the same button',
  lockedHere['pill-0'].movable === false, JSON.stringify(lockedHere['pill-0']));

// The other level's sheet gets the same place and the same size.
check('the Basement sheet opens', await openSheet('Floor · Basement'));
const other = await pieces();
check('every sheet now draws the colour scale in that one place, at that one size',
  Math.abs(other['legend-0'].x - lockedHere['legend-0'].x) < 0.6 &&
  Math.abs(other['legend-0'].y - lockedHere['legend-0'].y) < 0.6 &&
  other['legend-0'].transform === lockedHere['legend-0'].transform,
  JSON.stringify({ mainLevel: lockedHere['legend-0'], basement: other['legend-0'] }));

// A locked size is carried in the report, not read off this device: the
// stored report knows how big to draw it even where the device's own control
// says something else.
const stored = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const doc = rec.reportBuilder || rec.report;
  const floors = (doc.pages || []).filter((p) => p.type === 'floor' && p.meta && p.meta.layout);
  return floors.map((p) => ({
    level: p.meta.levelName,
    legend: p.meta.layout.legendLock,
    pill: p.meta.layout.pillLock,
    at: (p.meta.layout.overlays.find((o) => o.id === 'legend-0') || {}),
  }));
}, FILE);
check('the lock and its size are saved on the Customer File, on every sheet',
  stored.length >= 2 &&
  stored.every((s) => s.legend && s.legend.locked === true && s.legend.scale > 0) &&
  stored.every((s) => s.pill && s.pill.locked === true && s.pill.scale > 0),
  JSON.stringify(stored));

check('and every sheet stored the same spot for it',
  stored.every((s) => Math.abs(s.at.x - stored[0].at.x) < 0.01 &&
    Math.abs(s.at.y - stored[0].at.y) < 0.01),
  JSON.stringify(stored.map((s) => s.at)));

// Unlocking gives it back.
await page.evaluate(() => {
  const btn = document.querySelector('[data-rb-floor-lock-all]');
  if (btn) btn.click();
});
await new Promise((r) => setTimeout(r, 2000));
const unlocked = await pieces();
check('unlocking makes it movable again',
  unlocked['legend-0'].movable === true, JSON.stringify(unlocked['legend-0']));

await page.screenshot({ path: `${OUT}/report-floor-piece-locks.png` });
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
