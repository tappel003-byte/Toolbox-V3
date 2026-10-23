/**
 * The cover's CONTENTS lists every figure in the report, and the frame holds
 * them. Run: node tests/report-cover-contents.mjs   (needs a static server on 8765)
 *
 * The box was a fixed rectangle with the list clipped inside it. On a
 * four-level job — eleven figures — the frame showed seven and a half: Figure
 * 7 sliced through the middle and 8 to 11 simply gone. A cover that tells a
 * client the report contains less than it does is worse than an ugly one.
 *
 * Tim, Oct 20: "the table of content box doesn't change with the data...
 * there's no way to increase the box size, it doesn't automatically adjust
 * with the contents."
 *
 * So the stored height is a floor, not a ceiling: the frame grows to hold its
 * figures. If it would grow off the bottom of the sheet, the type steps down
 * instead of the list being cut. Both are checked here, on four levels and on
 * six, and once more on the printed deck — which is a different sheet from the
 * one on screen and has to measure itself.
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
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

/** A job with however many levels, each with readings, pins and photographs. */
async function seed(id, levels) {
  await page.evaluate(async (fileId, howMany) => {
    const plan = (() => {
      const c = document.createElement('canvas');
      c.width = 1200;
      c.height = 900;
      const x = c.getContext('2d');
      x.fillStyle = '#ffffff';
      x.fillRect(0, 0, 1200, 900);
      x.strokeStyle = '#111';
      x.lineWidth = 7;
      x.strokeRect(60, 60, 1080, 780);
      return c.toDataURL('image/jpeg', 0.9);
    })();
    const names = ['Main Level', 'Basement', 'Second Story', 'Detached Shop', 'Garage', 'Attic'];
    const record = window.ToolboxApp.blankCustomerFile(fileId);
    window.ToolboxPlanSetup.ensurePlanSetup(record);
    record.firstName = 'Dana';
    record.lastName = 'Whitfield';
    record.propertyAddress = '44 Audit Road\nSanta Fe, NM 87505';
    for (let i = 1; i < howMany; i += 1) {
      record.planSetup.canvases.push(
        window.ToolboxPlanSetup.blankCanvas(names[i] || ('Level ' + (i + 1))));
    }
    const byCanvas = {};
    const pins = [];
    for (let i = 0; i < record.planSetup.canvases.length; i += 1) {
      const cv = record.planSetup.canvases[i];
      cv.name = names[i] || ('Level ' + (i + 1));
      const planId = 'plan-' + fileId + '-' + i;
      await window.ToolboxDB.putMedia(planId, plan);
      cv.plan = { id: planId, width: 1200, height: 900 };
      cv.frontDoorFacing = 'N';
      const poly = [{ x: 60, y: 60 }, { x: 1140, y: 60 }, { x: 1140, y: 840 }, { x: 60, y: 840 }];
      const points = [];
      let n = 0;
      for (let row = 0; row < 3; row += 1) {
        for (let col = 0; col < 4; col += 1) {
          n += 1;
          points.push({ id: 'p' + i + '_' + n, floorId: cv.id, index: n,
            x: 200 + col * 250, y: 200 + row * 220, value: 7 + ((n * 7) % 25) / 10 });
        }
      }
      byCanvas[cv.id] = { canvasId: cv.id, points,
        areas: [{ id: 'a' + i, name: cv.name, polygon: poly, createdAt: 1 }], boundary: poly };
      for (let k = 1; k <= 3; k += 1) {
        const photoId = 'ph-' + i + '-' + k;
        await window.ToolboxDB.putMedia(photoId, plan);
        pins.push({ id: 'pin-' + i + '-' + k, num: pins.length + 1, canvasId: cv.id,
          x: 200 + k * 200, y: 250 + k * 150, location: 'Room ' + k,
          description: 'Crack ' + k, photos: [{ id: photoId }] });
      }
    }
    record.floorSurvey = { id: 'fs-' + fileId, inspectionDate: '2026-10-01', byCanvasId: byCanvas };
    record.distress = { updatedAt: new Date().toISOString(), mode: 'internal', startNum: 1,
      nextNum: pins.length + 1, activeCanvasId: record.planSetup.canvases[0].id, pins };
    await window.ToolboxDB.saveCustomerFile(record);
  }, id, levels);
}

/** Open the report and look at the cover. */
async function coverFacts(id) {
  await page.goto(`${BASE}#/file/${id}/report`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
  await new Promise((r) => setTimeout(r, 4000));
  await page.evaluate(() => { document.querySelectorAll('.rb-thumb')[0].click(); });
  await new Promise((r) => setTimeout(r, 1500));
  return page.evaluate(() => {
    const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
    const box = sheet.querySelector('[data-rb-cover-box="contents"]');
    const inner = sheet.querySelector('.rb-cover__contents');
    const items = [...sheet.querySelectorAll('.rb-cover__contents-item')];
    const sheetRect = sheet.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    // A line is only really shown if it sits inside the frame it is drawn in.
    const inside = items.filter((item) => {
      const r = item.getBoundingClientRect();
      return r.bottom <= boxRect.bottom + 1 && r.top >= boxRect.top - 1;
    }).length;
    return {
      // Every slide except the cover itself is a contents line.
      slides: document.querySelectorAll('.rb-thumb').length,
      lines: items.length,
      // A single line may now stand for a RUN of figures -- "Figures 5-14
      // Pictures" -- so what has to be true is that every figure is still
      // accounted for, not that there is one row apiece. This is the
      // stronger claim: it fails if a span ever covers the wrong figures.
      covered: items.reduce(function (total, item) {
        var numEl = item.querySelector('.rb-cover__contents-num');
        var label = numEl ? numEl.textContent : '';
        var span = label.match(/(\d+)\s*[\u2013-]\s*(\d+)/);
        if (span) return total + (Number(span[2]) - Number(span[1]) + 1);
        return total + 1;
      }, 0),
      inside,
      needs: Math.round(inner.scrollHeight),
      has: Math.round(inner.clientHeight),
      onSheet: boxRect.bottom <= sheetRect.bottom + 1,
      fit: Number(getComputedStyle(box).getPropertyValue('--rb-contents-fit') || 1),
    };
  });
}

await seed('cover-four', 4);
const four = await coverFacts('cover-four');
check('a four-level job lists every figure, inside the frame',
  four.covered === four.slides - 1 && four.inside === four.lines &&
  four.needs <= four.has + 1 && four.onSheet,
  JSON.stringify(four));

await seed('cover-six', 6);
const six = await coverFacts('cover-six');
check('a six-level job does the same, and stays on the paper',
  six.covered === six.slides - 1 && six.inside === six.lines &&
  six.needs <= six.has + 1 && six.onSheet,
  JSON.stringify(six));

check('the frame grew rather than the list being cut',
  six.has > four.has && six.lines > four.lines,
  JSON.stringify({ fourLines: four.lines, fourHeight: four.has,
    sixLines: six.lines, sixHeight: six.has }));

// Clicking a box brings out its pulls, and they stay out.
//
// They used to appear on hover alone, which failed in practice: a cover box
// is mostly text, so pointing at one usually means pointing at a field, and
// the contents frame had its list hanging below its own rectangle -- so the
// rows being clicked were not inside the box and nothing lit up. Tim: "I do
// like the corner pull but I don't like them visible all the time. I wanted
// them to where you highlighted it, but I highlighted that box numerous
// times yesterday and it would not show the pulls."
const pulls = await page.evaluate(() => {
  const box = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-cover-box="contents"]');
  const shown = (sel) => {
    const el = box.querySelector(sel);
    return !!el && getComputedStyle(el).display !== 'none';
  };
  return { move: shown('.rb-cover-box__move'), grip: shown('.rb-cover-box__resize') };
});
check('the pulls are not on show until a box is worked on',
  !pulls.move && !pulls.grip, JSON.stringify(pulls));

const rowPoint = await page.evaluate(() => {
  const items = [...document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) .rb-cover__contents-item')];
  // The "Figure N" label of a row well down the list: not editable, not the
  // jump chevron -- the part of a row a person clicks meaning "this box".
  const num = items[Math.min(5, items.length - 1)].querySelector('.rb-cover__contents-num');
  const r = num.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.mouse.click(rowPoint.x, rowPoint.y);
await new Promise((r) => setTimeout(r, 400));
const afterClick = await page.evaluate(() => {
  const box = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-cover-box="contents"]');
  const shown = (sel) => {
    const el = box.querySelector(sel);
    return !!el && getComputedStyle(el).display !== 'none';
  };
  return { active: box.classList.contains('is-active'),
    move: shown('.rb-cover-box__move'), grip: shown('.rb-cover-box__resize'),
    outline: getComputedStyle(box).outlineStyle };
});
// And they stay out when the pointer goes elsewhere.
await page.mouse.move(30, 940);
await new Promise((r) => setTimeout(r, 300));
const afterMoveAway = await page.evaluate(() => {
  const box = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-cover-box="contents"]');
  const el = box.querySelector('.rb-cover-box__resize');
  return { grip: !!el && getComputedStyle(el).display !== 'none' };
});
check('clicking a contents line brings the pulls out, and they stay',
  afterClick.active && afterClick.move && afterClick.grip &&
  afterClick.outline === 'dashed' && afterMoveAway.grip,
  JSON.stringify({ afterClick, afterMoveAway }));

// The printed cover is its own sheet and has to measure itself.
await page.evaluate(() => { window.print = () => {}; });
await page.emulateMediaType('print');
await page.click('#rb-print');
await page.waitForFunction(
  () => !!document.querySelector('.rb-print .rb-cover__contents'), { timeout: 20000 });
await new Promise((r) => setTimeout(r, 1500));
const printed = await page.evaluate(() => {
  const sheet = [...document.querySelectorAll('.rb-print .rb-sheet')]
    .find((el) => el.querySelector('.rb-cover__contents'));
  const box = sheet.querySelector('[data-rb-cover-box="contents"]');
  const inner = sheet.querySelector('.rb-cover__contents');
  const items = [...sheet.querySelectorAll('.rb-cover__contents-item')];
  const boxRect = box.getBoundingClientRect();
  const sheetRect = sheet.getBoundingClientRect();
  return {
    lines: items.length,
    inside: items.filter((item) => {
      const r = item.getBoundingClientRect();
      return r.bottom <= boxRect.bottom + 1 && r.top >= boxRect.top - 1;
    }).length,
    needs: Math.round(inner.scrollHeight),
    has: Math.round(inner.clientHeight),
    onSheet: boxRect.bottom <= sheetRect.bottom + 1,
  };
});
check('and the printed cover carries all of them too',
  printed.lines === six.lines && printed.inside === printed.lines &&
  printed.needs <= printed.has + 1 && printed.onSheet,
  JSON.stringify(printed));
await page.emulateMediaType(null);

await page.screenshot({ path: `${OUT}/report-cover-contents.png` });
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
