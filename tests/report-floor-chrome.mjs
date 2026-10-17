/**
 * The colour scale and the readings are one piece, on the page.
 * Run: node tests/report-floor-chrome.mjs   (needs a static server on 8765)
 *
 * They used to be painted into the plan's own picture — two separate things,
 * each anchored to the drawing — so moving the plan carried them with it and
 * neither could be put where the sheet wanted it. Tim: "putting the contour
 * legend in the pill, one place, and being able to move the floor plan with
 * contours separately... those need to be able to move just like they do on
 * the FS page."
 *
 * So the drawing carries the plan, the contours, the readings and the High
 * and Low markers — those point at a spot on the floor and belong to the
 * picture — and the scale and that boundary's H / L / delta are one box on
 * the page, dragged where they are wanted and left there while the plan is
 * panned and zoomed underneath.
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
}, FILE);

async function openSlide() {
  await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector('.rb-thumb[data-page-id^="floor-"]'), { timeout: 25000 });
  await page.evaluate(() => document.querySelector('.rb-thumb[data-page-id^="floor-"]').click());
  await page.waitForFunction(
    () => !!document.querySelector('[data-rb-floor-import]') ||
      !!document.querySelector('[data-rb-floor-box="topo"]'), { timeout: 20000 });
  if (await page.$('[data-rb-floor-import]')) {
    await page.click('[data-rb-floor-import]');
    await page.waitForFunction(() => !!document.querySelector('[data-rb-floor-box="topo"]'), { timeout: 30000 });
  }
  await new Promise((r) => setTimeout(r, 2500));
}

const piece = () => page.evaluate(() => {
  const box = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-box^="chrome"]');
  if (!box) return null;
  const r = box.getBoundingClientRect();
  return {
    x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
    scale: !!box.querySelector('.rb-topo-legend__bar span'),
    readings: (box.querySelector('.rb-topo-stats')?.textContent || '').replace(/\s+/g, ' ').trim(),
    outline: getComputedStyle(box).outlineStyle,
    grips: [...box.querySelectorAll('.rb-floor-box__resize')]
      .filter((g) => getComputedStyle(g).display !== 'none').length,
  };
});

await openSlide();

const placed = await piece();
check('the scale and the readings are one piece on the page',
  !!placed && placed.scale && /H\s*9\.4/.test(placed.readings) && /L\s*7\.1/.test(placed.readings),
  JSON.stringify(placed));
check('and it carries no chrome of its own until it is pointed at',
  !!placed && placed.outline === 'none' && placed.grips === 0, JSON.stringify(placed));

// It moves where it is dragged, like every other box on the sheet.
await page.mouse.move(placed.x + 6, placed.y + placed.h / 2);
await page.mouse.down();
await page.mouse.move(placed.x + 6 + 230, placed.y + placed.h / 2 + 170, { steps: 14 });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 900));
const moved = await piece();
check('it moves where it is dragged',
  moved.x > placed.x + 180 && moved.y > placed.y + 120,
  JSON.stringify({ from: { x: placed.x, y: placed.y }, to: { x: moved.x, y: moved.y } }));

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
const afterPan = await piece();
check('panning the plan leaves it exactly where it was put',
  Math.abs(afterPan.x - moved.x) < 3 && Math.abs(afterPan.y - moved.y) < 3,
  JSON.stringify({ moved: { x: moved.x, y: moved.y }, afterPan: { x: afterPan.x, y: afterPan.y } }));

await page.waitForFunction(
  () => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''), { timeout: 15000 });
const stored = await page.evaluate(async (id) => {
  const record = await window.ToolboxDB.getCustomerFile(id);
  const floor = (record.reportBuilder?.pages || []).find((p) => p.type === 'floor');
  const overlays = floor?.meta?.layout?.overlays || [];
  return {
    kinds: overlays.map((o) => o.kind).sort(),
    chrome: overlays.find((o) => o.kind === 'chrome') || null,
  };
}, FILE);
check('one piece per boundary is what the Customer File carries',
  stored.kinds.filter((k) => k === 'chrome').length === 1 &&
  stored.kinds.indexOf('legend') === -1 && stored.kinds.indexOf('pill') === -1,
  JSON.stringify(stored.kinds));

await openSlide();
const reopened = await piece();
check('and it is still where it was put after coming back',
  Math.abs(reopened.x - afterPan.x) < 4 && Math.abs(reopened.y - afterPan.y) < 4,
  JSON.stringify({ afterPan: { x: afterPan.x, y: afterPan.y }, reopened: { x: reopened.x, y: reopened.y } }));

await page.screenshot({ path: `${OUT}/report-floor-chrome.png` });
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
