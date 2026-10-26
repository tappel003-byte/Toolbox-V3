/**
 * The colour scale and the readings are pieces on the page, each moved alone.
 * Run: node tests/report-floor-chrome.mjs   (needs a static server on 8765)
 *
 * They used to be painted into the plan's own picture — two separate things,
 * each anchored to the drawing — so moving the plan carried them with it and
 * neither could be put where the sheet wanted it. Tim: "putting the contour
 * legend in the pill, one place, and being able to move the floor plan with
 * contours separately... those need to be able to move just like they do on
 * the FS page."
 *
 * And: "those need to be movable separately... the high/low/delta pill, the
 * contour legend, those are all movable."
 *
 * So the drawing carries the plan, the contours, the readings and the High
 * and Low markers — those point at a spot on the floor and belong to the
 * picture — while the colour scale and that boundary's H / L / delta are two
 * boxes on the page. Each is dragged on its own, neither moves when the
 * other does, and the plan pans and zooms underneath without taking either
 * along.
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
const FILE = 'rb-floor-chrome';
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

await page.evaluate(async (id) => {
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 700;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 900, 700);
  ctx.strokeStyle = '#222222';
  ctx.lineWidth = 5;
  ctx.strokeRect(50, 50, 800, 600);
  await window.ToolboxDB.putMedia('plan-chrome', canvas.toDataURL('image/png'));

  const record = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(record);
  record.firstName = 'Hal';
  record.lastName = 'Scale';
  record.propertyAddress = '9 Legend Lane\nSanta Fe, NM 87505';
  const first = record.planSetup.canvases[0];
  first.name = 'Main Level';
  first.plan = { id: 'plan-chrome', width: 900, height: 700 };
  first.frontDoorFacing = 'N';
  const poly = [{ x: 60, y: 60 }, { x: 840, y: 60 }, { x: 840, y: 640 }, { x: 60, y: 640 }];
  const points = [];
  let i = 0;
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      i += 1;
      points.push({
        id: 'p' + i, floorId: first.id, index: i,
        x: 140 + col * 150, y: 150 + row * 140, value: 7 + ((i * 7) % 25) / 10,
      });
    }
  }
  record.floorSurvey = {
    id: 'fs-chrome',
    inspectionDate: '2026-10-01',
    byCanvasId: {
      [first.id]: {
        canvasId: first.id, points,
        areas: [{ id: 'a1', name: 'Main Level', polygon: poly, createdAt: 1 }],
        boundary: poly,
      },
    },
  };
  await window.ToolboxDB.saveCustomerFile(record);
  // The readings are sized by Stats pill size, the control that sizes them in
  // Floor Survey. Set away from its default so a piece drawn at the wrong
  // size is visible as a wrong size rather than as the default.
  try { window.localStorage.setItem('stats-chip-size', '48'); } catch (_) {}
}, FILE);

async function openSlide() {
  await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector('.rb-thumb[data-page-id^="floor-"]'), { timeout: 25000 });
  await page.evaluate(() => document.querySelector('.rb-thumb[data-page-id^="floor-"]').click());
  await page.waitForFunction(
    () => !!document.querySelector('[data-rb-floor-import]') ||
      !!document.querySelector('[data-rb-floor-box^="topo"]'), { timeout: 20000 });
  if (await page.$('[data-rb-floor-import]')) {
    await page.click('[data-rb-floor-import]');
    await page.waitForFunction(() => !!document.querySelector('[data-rb-floor-box^="topo"]'), { timeout: 30000 });
  }
  await new Promise((r) => setTimeout(r, 2500));
}

const piece = (which) => page.evaluate((kind) => {
  const box = document.querySelector(
    '.rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-box^="' + kind + '"]');
  if (!box) return null;
  const r = box.getBoundingClientRect();
  return {
    x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
    // The colour scale is Floor Survey's own, painted by Floor Survey and
    // placed here as a picture.
    scale: (() => {
      const img = box.querySelector('.rb-topo-legend__img');
      if (!img) return false;
      return /^data:image\/png/.test(img.getAttribute('src') || '') &&
        img.naturalWidth > 40 && img.naturalHeight > img.naturalWidth;
    })(),
    readings: (box.querySelector('.rb-topo-stats')?.textContent || '').replace(/\s+/g, ' ').trim(),
    outline: getComputedStyle(box).outlineStyle,
    grips: [...box.querySelectorAll('.rb-floor-box__resize')]
      .filter((g) => getComputedStyle(g).display !== 'none').length,
  };
}, which);

/** Drag a piece by its left edge and report where both ended up. */
async function dragPiece(which, dx, dy) {
  const from = { legend: await piece('legend'), pill: await piece('pill') };
  const box = from[which];
  await page.mouse.move(box.x + 3, box.y + box.h / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 3 + dx, box.y + box.h / 2 + dy, { steps: 14 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 900));
  const to = { legend: await piece('legend'), pill: await piece('pill') };
  return {
    legend: { dx: to.legend.x - from.legend.x, dy: to.legend.y - from.legend.y },
    pill: { dx: to.pill.x - from.pill.x, dy: to.pill.y - from.pill.y },
  };
}

await openSlide();

const scaleBox = await piece('legend');
const pillBox = await piece('pill');
check('the colour scale is a piece on the page',
  !!scaleBox && scaleBox.scale, JSON.stringify(scaleBox));
check('the readings are a piece of their own',
  !!pillBox && /H\s*9\.4/.test(pillBox.readings) && /L\s*7\.1/.test(pillBox.readings),
  JSON.stringify(pillBox));
check('and neither carries chrome of its own until it is pointed at',
  scaleBox.outline === 'none' && scaleBox.grips === 0 &&
  pillBox.outline === 'none' && pillBox.grips === 0,
  JSON.stringify({ scaleBox, pillBox }));

// Each moves on its own, and leaves the other where it was.
const draggedScale = await dragPiece('legend', 150, 220);
check('the colour scale moves on its own',
  draggedScale.legend.dx > 110 && draggedScale.legend.dy > 170 &&
  draggedScale.pill.dx === 0 && draggedScale.pill.dy === 0,
  JSON.stringify(draggedScale));

const draggedPill = await dragPiece('pill', 240, -90);
check('and the readings move on their own',
  draggedPill.pill.dx > 200 && draggedPill.pill.dy < -60 &&
  draggedPill.legend.dx === 0 && draggedPill.legend.dy === 0,
  JSON.stringify(draggedPill));

// Moving a piece moves it. It used to resize it too: the drag wrote a second
// size over the top -- the per-piece scale left in the layout by an older
// build that gave these two corner handles -- so a piece sat at one size
// until it was touched and jumped to another the moment it was dragged. Tim:
// "the high-low delta pill needs to be selected and moved before it sizes
// right... legends, you have to select before they size right."
const pillAfterMove = await piece('pill');
check('and moving a piece does not resize it',
  pillAfterMove.h > 22 &&
  Math.abs(pillAfterMove.w - pillBox.w) < 2 && Math.abs(pillAfterMove.h - pillBox.h) < 2,
  JSON.stringify({ before: { w: pillBox.w, h: pillBox.h },
    after: { w: pillAfterMove.w, h: pillAfterMove.h } }));

const moved = await piece('legend');

// And the plan moves underneath it without taking it along.
const planBox = await page.evaluate(() => {
  const r = document.querySelector('[data-rb-topo-live]').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
await page.mouse.move(planBox.x + planBox.w * 0.75, planBox.y + planBox.h * 0.75);
await page.mouse.down();
await page.mouse.move(planBox.x + planBox.w * 0.75 - 150, planBox.y + planBox.h * 0.75 - 110, { steps: 14 });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 1200));
const afterPan = await piece('legend');
const afterPanPill = await piece('pill');
check('panning the plan leaves both exactly where they were put',
  Math.abs(afterPan.x - moved.x) < 3 && Math.abs(afterPan.y - moved.y) < 3,
  JSON.stringify({ moved: { x: moved.x, y: moved.y }, afterPan: { x: afterPan.x, y: afterPan.y } }));

await page.waitForFunction(
  () => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''), { timeout: 15000 });
// One record for the report, not a copy per slide: the layout lives on
// reportBuilder.floorLayout and every Floor Survey page draws it.
const stored = await page.evaluate(async (id) => {
  const record = await window.ToolboxDB.getCustomerFile(id);
  const overlays = record.reportBuilder?.floorLayout?.overlays || [];
  return { kinds: overlays.map((o) => o.kind).sort() };
}, FILE);
check('the Customer File carries one of each, per boundary',
  stored.kinds.filter((k) => k === 'legend').length === 1 &&
  stored.kinds.filter((k) => k === 'pill').length === 1 &&
  stored.kinds.indexOf('chrome') === -1,
  JSON.stringify(stored.kinds));

await openSlide();
const reopened = await piece('legend');
const reopenedPill = await piece('pill');
check('and both are still where they were put after coming back',
  Math.abs(reopened.x - afterPan.x) < 4 && Math.abs(reopened.y - afterPan.y) < 4 &&
  Math.abs(reopenedPill.x - afterPanPill.x) < 4 && Math.abs(reopenedPill.y - afterPanPill.y) < 4,
  JSON.stringify({ reopened, reopenedPill }));

// Right-click a piece to move it behind or in front of the others. Tim: "I
// need to be able to right click and put images behind or in front."
const stackOf = () => page.evaluate(() => {
  const read = (sel) => {
    const el = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) ' + sel);
    return el ? Number(el.style.zIndex) : null;
  };
  return {
    scale: read('[data-rb-floor-box^="legend"]'),
    plan: read('[data-rb-floor-box^="topo"]'),
    readings: read('[data-rb-floor-box^="pill"]'),
  };
});
const stackStart = await stackOf();
check('the drawing is underneath, the scale and the readings on top',
  stackStart.plan < stackStart.scale && stackStart.plan < stackStart.readings,
  JSON.stringify(stackStart));

const scaleAt = await piece('legend');
await page.mouse.click(scaleAt.x + scaleAt.w / 2, scaleAt.y + scaleAt.h / 2, { button: 'right' });
await new Promise((r) => setTimeout(r, 400));
const menu = await page.evaluate(() => {
  const el = document.querySelector('[data-rb-stackmenu]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    items: [...el.querySelectorAll('.rb-stackmenu__item')].map((b) => b.textContent.trim()),
    onScreen: r.left >= 0 && r.top >= 0 &&
      r.right <= window.innerWidth && r.bottom <= window.innerHeight,
  };
});
check('right-clicking a piece offers behind and in front, on the screen',
  !!menu && menu.items.join(' | ') === 'Bring to front | Send to back' && menu.onScreen,
  JSON.stringify(menu));

await page.screenshot({ path: `${OUT}/report-floor-stackmenu.png` });
await page.click('[data-rb-stackmenu] [data-rb-stack="back"]');
await new Promise((r) => setTimeout(r, 900));
const stackBack = await stackOf();
check('Send to back puts the colour scale under the drawing',
  stackBack.scale < stackBack.plan && stackBack.readings === stackStart.readings &&
  !(await page.$('[data-rb-stackmenu]')),
  JSON.stringify({ stackStart, stackBack }));

await openSlide();
const stackKept = await stackOf();
check('and it is still behind when the report is reopened',
  stackKept.scale < stackKept.plan, JSON.stringify(stackKept));

const planAt = await piece('topo');
await page.mouse.click(planAt.x + planAt.w / 2, planAt.y + 14, { button: 'right' });
await new Promise((r) => setTimeout(r, 400));
await page.click('[data-rb-stackmenu] [data-rb-stack="back"]');
await new Promise((r) => setTimeout(r, 900));
const stackPlanBack = await stackOf();
check('and the drawing itself can be sent behind the scale again',
  stackPlanBack.plan < stackPlanBack.scale,
  JSON.stringify(stackPlanBack));

// The scale is a key on the paper, so its size belongs to the paper. Tim:
// "it does not lock the size, its different than the FS legend." It was drawn
// here in screen pixels -- an 8px label beside an 88px bar -- so it was a
// different fraction of the sheet on every window, and different again in
// print. It is Floor Survey's own scale now, at the size Floor Survey draws
// it: 226 of its 1100-unit reference across the long side of the sheet.
const sheetShare = () => page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)').getBoundingClientRect();
  const box = document.querySelector(
    '.rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-box^="legend"]').getBoundingClientRect();
  return {
    sheet: Math.round(sheet.width),
    tall: +((box.height / sheet.width) * 100).toFixed(1),
    wide: +((box.width / sheet.width) * 100).toFixed(1),
    ticks: (document.querySelector('.rb-topo-legend__img') || {}).naturalHeight || 0,
  };
});
const wideWindow = await sheetShare();
await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1 });
await new Promise((r) => setTimeout(r, 1400));
const narrowWindow = await sheetShare();
check('the colour scale is the size Floor Survey draws it, whatever the window',
  narrowWindow.sheet < wideWindow.sheet - 100 &&
  Math.abs(wideWindow.tall - 20.5) < 0.6 && Math.abs(narrowWindow.tall - 20.5) < 0.6 &&
  Math.abs(wideWindow.wide - narrowWindow.wide) < 0.3,
  JSON.stringify({ wideWindow, narrowWindow }));
await page.setViewport({ width: 1700, height: 1050, deviceScaleFactor: 1 });
await new Promise((r) => setTimeout(r, 1200));

// And on the paper. The printed deck declares its sheets in inches, so this
// is the one place the scale's size can be read in the units it is cut at.
await page.evaluate(() => { window.print = () => {}; });
await page.emulateMediaType('print');
await page.click('#rb-print');
await page.waitForFunction(
  () => !!document.querySelector('.rb-print .rb-sheet [data-rb-floor-box^="legend"]'),
  { timeout: 20000 });
await new Promise((r) => setTimeout(r, 1200));
const printed = await page.evaluate(() => {
  const sheet = [...document.querySelectorAll('.rb-print .rb-sheet')]
    .find((el) => el.querySelector('[data-rb-floor-box^="legend"]'));
  const box = sheet.querySelector('[data-rb-floor-box^="legend"]');
  const img = sheet.querySelector('.rb-topo-legend__img');
  // 96 CSS px to the inch.
  return {
    sheetIn: +(sheet.getBoundingClientRect().width / 96).toFixed(2),
    tallIn: +(box.getBoundingClientRect().height / 96).toFixed(2),
    wideIn: +(box.getBoundingClientRect().width / 96).toFixed(2),
    painted: !!img && /^data:image\/png/.test(img.getAttribute('src') || ''),
  };
});
check('and it keeps that size on the printed sheet',
  printed.painted && Math.abs(printed.sheetIn - 17) < 0.2 &&
  Math.abs(printed.tallIn - 3.49) < 0.12 && Math.abs(printed.wideIn - 1.27) < 0.08,
  JSON.stringify(printed));
await page.emulateMediaType(null);
await new Promise((r) => setTimeout(r, 600));

await page.screenshot({ path: `${OUT}/report-floor-chrome.png` });
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
