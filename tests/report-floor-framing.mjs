/**
 * A Floor Survey drawing on a report sheet holds the view it was given.
 * Run: node tests/report-floor-framing.mjs   (needs a static server on 8765)
 *
 * Tim, Oct 17, on a sheet carrying two views of one level: "I need them to be
 * side by side exactly. not one higher one lower", and, separately, "when I
 * moved away from the screen the screens moved for the FS."
 *
 * Both are the same fault seen twice. The drawing's pan and zoom were kept in
 * frame pixels, and a report frame is sized by the paper: it changes with the
 * window, when a sheet goes from one view to two, and between the screen and
 * the printed page. So the plan kept the scale and the offset it was fitted at
 * and sat shifted in the new frame. And a pan was told only to the book, which
 * does not re-mount a view already showing the right level, so dragging one of
 * two drawings left the other where it was.
 *
 * What is checked is what the investigator sees: the plan sits in the same
 * place in its frame however big the frame is, it is still there after leaving
 * the sheet and coming back, two views start lined up exactly, dragging either
 * one moves both together, and the pair is still where it was put when the
 * report is reopened.
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
const FILE = 'rb-floor-framing';
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
  // A plan with a dark border, so where the drawing sits can be measured off
  // the canvas rather than guessed at.
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 700;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 900, 700);
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = 6;
  ctx.strokeRect(40, 40, 820, 620);
  await window.ToolboxDB.putMedia('plan-framing', canvas.toDataURL('image/png'));

  const record = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(record);
  record.firstName = 'Dana';
  record.lastName = 'Frame';
  record.propertyAddress = '1 Framing Way\nSanta Fe, NM 87505';
  const first = record.planSetup.canvases[0];
  first.name = 'Main Level';
  first.plan = { id: 'plan-framing', width: 900, height: 700 };
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
    id: 'fs-framing',
    inspectionDate: '2026-10-01',
    byCanvasId: {
      [first.id]: {
        canvasId: first.id, points, boundary: poly,
        areas: [{ id: 'a1', name: 'Main Level', polygon: poly, createdAt: 1 }],
      },
    },
  };
  await window.ToolboxDB.saveCustomerFile(record);
}, FILE);

async function openSlide() {
  await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(
    () => document.querySelector('.rb-thumb[data-page-id^="floor-"]'), { timeout: 25000 });
  await page.evaluate(() => document.querySelector('.rb-thumb[data-page-id^="floor-"]').click());
  await page.waitForFunction(
    () => !!document.querySelector('[data-rb-floor-import]') ||
      !!document.querySelector('[data-rb-floor-box^="topo"]'), { timeout: 20000 });
  if (await page.$('[data-rb-floor-import]')) {
    await page.click('[data-rb-floor-import]');
    await page.waitForFunction(
      () => !!document.querySelector('[data-rb-floor-box^="topo"]'), { timeout: 30000 });
  }
  await new Promise((r) => setTimeout(r, 3000));
}

/**
 * Where the plan is drawn in each live view, as a fraction of its own frame.
 *
 * A fraction, not pixels, because the whole question is whether the same view
 * survives a change of frame size: in pixels every number would differ even
 * when nothing moved.
 */
function views() {
  return page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) [data-rb-topo-live] canvas')
      .forEach((canvas) => {
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;
        const data = ctx.getImageData(0, 0, w, h).data;
        let x0 = w;
        let y0 = h;
        let x1 = -1;
        let y1 = -1;
        for (let y = 0; y < h; y += 2) {
          for (let x = 0; x < w; x += 2) {
            const i = (y * w + x) * 4;
            if (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200) {
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
              if (y < y0) y0 = y;
              if (y > y1) y1 = y;
            }
          }
        }
        if (x1 < 0) { out.push(null); return; }
        out.push({
          frame: { w: Math.round(w), h: Math.round(h) },
          x: +(x0 / w).toFixed(3),
          y: +(y0 / h).toFixed(3),
          w: +((x1 - x0) / w).toFixed(3),
          h: +((y1 - y0) / h).toFixed(3),
        });
      });
    return out;
  });
}

/** Same framing, within a pixel or two of measuring error. */
function framedAlike(a, b, slack = 0.01) {
  if (!a || !b) return false;
  return ['x', 'y', 'w', 'h'].every((k) => Math.abs(a[k] - b[k]) <= slack);
}

await openSlide();
const first = await views();
check('the slide shows one live drawing of the level',
  first.length === 1 && !!first[0], JSON.stringify(first));

// The paper is 11x17 and stays 11x17. A smaller window zooms it down to fit;
// it does not make the page smaller, so the frame keeps its own size and the
// drawing keeps its framing. Before, the sheet was resized to the window,
// which is what let a style set in pixels take up a different share of the
// page on every screen.
await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });
await new Promise((r) => setTimeout(r, 1500));
const smaller = await views();
check('a smaller window zooms the paper, it does not resize the page',
  smaller[0].frame.w === first[0].frame.w && framedAlike(first[0], smaller[0]),
  JSON.stringify({ first: first[0], smaller: smaller[0] }));

await page.setViewport({ width: 1700, height: 1050, deviceScaleFactor: 1 });
await new Promise((r) => setTimeout(r, 1500));
check('and so does the sheet it came back to',
  framedAlike(first[0], (await views())[0]), '');

// Tim: "when I moved away from the screen the screens moved for the FS."
await page.goto(`${BASE}#/`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 800));
await openSlide();
check('leaving the sheet and coming back leaves the drawing where it was',
  framedAlike(first[0], (await views())[0]), JSON.stringify(await views()));

// Two views of one level. Tim: "I need them to be side by side exactly."
await page.evaluate(() => {
  document.querySelector('[data-rb-floor-view="add"]')?.click();
});
await page.waitForFunction(
  () => document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) [data-rb-topo-live]').length >= 2,
  { timeout: 20000 });
await new Promise((r) => setTimeout(r, 2000));
const pair = await views();
check('two views open framed exactly alike',
  pair.length === 2 && framedAlike(pair[0], pair[1], 0.002),
  JSON.stringify(pair));

// Dragging either drawing moves both: one level, one camera.
const left = await page.evaluate(() => {
  const r = document.querySelectorAll('[data-rb-topo-live]')[0].getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
await page.mouse.move(left.x + left.w * 0.5, left.y + left.h * 0.5);
await page.mouse.down();
await page.mouse.move(left.x + left.w * 0.5, left.y + left.h * 0.5 - 120, { steps: 16 });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 1800));
const panned = await views();
check('dragging one of the two moves both, exactly together',
  panned[0].y < pair[0].y - 0.05 && framedAlike(panned[0], panned[1], 0.002),
  JSON.stringify({ pair: pair[0], panned }));

await page.waitForFunction(
  () => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''),
  { timeout: 15000 });
await page.goto(`${BASE}#/`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 800));
await openSlide();
const reopened = await views();
check('and the pair is still where it was put when the report is reopened',
  reopened.length === 2 &&
  framedAlike(panned[0], reopened[0]) && framedAlike(panned[0], reopened[1]),
  JSON.stringify({ panned: panned[0], reopened }));

// The printed sheet is a frame of another size again -- 17 in of paper where
// the screen had about 12 -- and the drawing printed small because it kept
// the pixels it was fitted at. It shows the same view on paper as on screen.
const screenInk = (await views())[0];
await page.evaluate(() => { window.print = () => {}; });
await page.emulateMediaType('print');
await page.click('#rb-print');
// The printed deck does not borrow the live drawing any more. There is one
// of it per slot in the whole page, so only the slide being looked at could
// hold it -- every other floor slide printed a note where its contour map
// should have been. Each printed slide now carries a still painted for it,
// and that still is what this measures.
await page.waitForFunction(
  () => [...document.querySelectorAll('.rb-print .rb-sheet')]
    .some((el) => {
      const img = el.querySelector('.rb-topo-still');
      return img && img.complete && img.naturalWidth > 0;
    }), { timeout: 20000 });
await new Promise((r) => setTimeout(r, 2500));
const printedInk = await page.evaluate(() => {
  const sheet = [...document.querySelectorAll('.rb-print .rb-sheet')]
    .find((el) => {
      const img = el.querySelector('.rb-topo-still');
      return img && img.complete && img.naturalWidth > 0;
    });
  const still = sheet.querySelector('.rb-topo-still');
  const canvas = document.createElement('canvas');
  canvas.width = still.naturalWidth;
  canvas.height = still.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(still, 0, 0);
  const w = canvas.width;
  const h = canvas.height;
  const data = ctx.getImageData(0, 0, w, h).data;
  let x0 = w; let y0 = h; let x1 = -1; let y1 = -1;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      if (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  // The still is CROPPED to its drawing, and it is placed with object-fit:
  // contain. So ink measured inside the PNG always fills the PNG, whatever
  // the slide looks like -- which is what this used to report, and why it
  // could never agree with the screen no matter how the page was framed.
  //
  // What has to match the screen is where the ink lands IN THE FRAME, so the
  // PNG box is carried through the letterbox the way the browser draws it.
  const box = still.getBoundingClientRect();
  const fit = Math.min(box.width / w, box.height / h);
  const drawnW = w * fit;
  const drawnH = h * fit;
  const padX = (box.width - drawnW) / 2;
  const padY = (box.height - drawnH) / 2;
  return {
    sheetIn: +(sheet.getBoundingClientRect().width / 96).toFixed(2),
    x: +((padX + x0 * fit) / box.width).toFixed(3),
    y: +((padY + y0 * fit) / box.height).toFixed(3),
    w: +(((x1 - x0) * fit) / box.width).toFixed(3),
    h: +(((y1 - y0) * fit) / box.height).toFixed(3),
  };
});
check('and the printed sheet shows the same view, on 17 in of paper',
  Math.abs(printedInk.sheetIn - 17) < 0.2 && framedAlike(screenInk, printedInk, 0.02),
  JSON.stringify({ screenInk, printedInk }));
await page.emulateMediaType(null);

await page.screenshot({ path: `${OUT}/report-floor-framing.png` });
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
