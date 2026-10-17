/**
 * No page of the report wears our chrome at rest.
 * Run: node tests/report-sheet-chrome.mjs   (needs a static server on 8765)
 *
 * Tim, Oct 17, looking at the title page: "all those corner blocks -- that's
 * one of the things I really dislike about this page", and then "if I don't
 * drop in a picture I want all the other buttons to go away."
 *
 * The rule those two settle is the whole report's, not the title page's: a
 * sheet shows the investigator's report and nothing else until a piece of it
 * is pointed at. Handles, dashed placement edges, empty-frame prompts and
 * placement buttons all wait to be asked for, and the one control a slide
 * owns outright -- Lock layout -- lives in the side rail with every other
 * control, not on the paper.
 *
 * This walks every page type the book can hold and fails on anything of ours
 * that is visible with the pointer parked off the sheet.
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
const FILE = 'rb-sheet-chrome';
const results = [];
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// Everything on a sheet that belongs to the editor rather than to the report.
// A dashed outline is read off the box itself, so the boxes are listed too
// and their outline style is checked rather than their presence.
const CHROME = [
  '.rb-cover-box__move',
  '.rb-cover-box__resize',
  '.rb-cover__overview-empty',
  '.rb-cover__overview-actions',
  '.rb-cover__contents-jump',
  '.rb-floor-box__resize',
  '.rb-floor-overview__remove',
  '.rb-plan-corner',
  '.rb-floor-toolbar',
  '[data-rb-cover-lock]',
  '[data-rb-cover-overview]',
  '.rb-brand__resize',
  '[data-rb-brand-lock]',
];

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
await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

await page.evaluate(async ({ png, id }) => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('toolbox', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(['customerFiles', 'media'], 'readwrite');
    transaction.objectStore('customerFiles').clear();
    transaction.objectStore('media').clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });

  const record = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(record);
  record.firstName = 'Jason';
  record.lastName = 'Mitchell';
  record.propertyAddress = '59 Lodge Trail\nSanta Fe, New Mexico, 87506';
  await window.ToolboxDB.putMedia('plan-chrome', png);
  const canvas = record.planSetup.canvases[0];
  canvas.name = 'Main Level';
  canvas.plan = { id: 'plan-chrome', width: 1200, height: 800 };
  const canvasId = canvas.id;

  // A boundary with readings, so the floor sheet has something to import.
  const boundary = [{ x: 120, y: 120 }, { x: 1080, y: 120 }, { x: 1080, y: 680 }, { x: 120, y: 680 }];
  const points = [];
  let n = 0;
  for (let gx = 0; gx < 5; gx += 1) {
    for (let gy = 0; gy < 3; gy += 1) {
      n += 1;
      points.push({
        id: 'p' + n, floorId: canvasId, index: n,
        x: 200 + gx * 190, y: 200 + gy * 180,
        value: 9.2 - gx * 0.4 - gy * 0.3,
        isBasePoint: n === 1, label: n === 1 ? 'BP1' : String(n),
        createdAt: Date.now(),
      });
    }
  }
  record.floorSurvey.inspectionDate = '2026-10-08';
  record.floorSurvey.byCanvasId[canvasId] = {
    canvasId, boundary, points,
    areas: [{ id: 'area-main', name: 'Main', polygon: boundary, createdAt: Date.now() }],
    createdAt: Date.now(), updatedAt: Date.now(),
  };

  // Pins, so there is a Picture Locations sheet and a Pictures sheet.
  const pins = [];
  for (let i = 1; i <= 4; i += 1) {
    const photoId = 'ph-chrome-' + i;
    await window.ToolboxDB.putMedia(photoId, png);
    pins.push({
      id: 'pin-' + i, num: i, canvasId,
      x: 0.2 + i * 0.12, y: 0.3 + (i % 3) * 0.15,
      location: 'Room ' + i, description: 'Observation ' + i,
      photos: [{ id: photoId }],
    });
  }
  record.distress = {
    mode: 'internal', startNum: 1, nextNum: pins.length + 1, activeCanvasId: canvasId, pins,
  };
  await window.ToolboxDB.saveCustomerFile(record);
}, { png: TINY_PNG, id: FILE });

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => document.querySelectorAll('.rb-thumb').length >= 4, { timeout: 25000 });

const slides = await page.evaluate(() => [...document.querySelectorAll('.rb-thumb')].map((thumb) => ({
  id: thumb.getAttribute('data-page-id') || '',
  caption: (thumb.querySelector('.rb-thumb__caption')?.textContent || '').trim(),
})));
check('the book holds a cover, a floor sheet, picture locations and pictures',
  slides.some((s) => s.id === 'cover') &&
  slides.some((s) => /^floor-/.test(s.id)) &&
  slides.some((s) => /Picture Locations/i.test(s.caption)) &&
  slides.some((s) => /^pictures-/.test(s.id)),
  slides.map((s) => s.caption).join(' | '));

/** Open a slide, park the pointer off the sheet, and read what is showing. */
async function restingChrome(id) {
  await page.evaluate((want) => {
    document.querySelector(`.rb-thumb[data-page-id="${want}"]`)?.click();
  }, id);
  await page.waitForFunction(
    (want) => document.querySelector('.rb-sheet')?.getAttribute('data-page-id') === want,
    { timeout: 15000 }, id);
  // A floor sheet is only worth looking at once its drawing is on it.
  const imported = await page.evaluate(() => {
    const btn = document.querySelector('[data-rb-floor-import]');
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (imported) await new Promise((r) => setTimeout(r, 3500));
  await page.mouse.move(2, 2);
  await new Promise((r) => setTimeout(r, 400));
  return page.evaluate((selectors) => {
    const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
    const seen = (el) => {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (Number(style.opacity) <= 0.05) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const showing = [];
    selectors.forEach((sel) => {
      sheet.querySelectorAll(sel).forEach((el) => { if (seen(el)) showing.push(sel); });
    });
    const outlined = [...sheet.querySelectorAll('.rb-cover-box, .rb-floor-box, .rb-brand')]
      .filter((box) => getComputedStyle(box).outlineStyle !== 'none').length;
    return { showing: [...new Set(showing)], outlined };
  }, CHROME);
}

for (const slide of slides) {
  const rest = await restingChrome(slide.id);
  check(`${slide.caption || slide.id} shows nothing of ours at rest`,
    rest.showing.length === 0 && rest.outlined === 0,
    JSON.stringify(rest));
}

// The handles are not gone, only waiting: a cover box still has both of its
// corner pulls in the sheet, ready for the pointer.
await page.evaluate(() => document.querySelector('.rb-thumb[data-page-id="cover"]')?.click());
await page.waitForFunction(
  () => document.querySelector('.rb-sheet')?.getAttribute('data-page-id') === 'cover',
  { timeout: 15000 });
const reachable = await page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
  return {
    moves: sheet.querySelectorAll('.rb-cover-box__move').length,
    resizes: sheet.querySelectorAll('.rb-cover-box__resize').length,
    lockInRail: !!document.querySelector('.rb-panel [data-rb-cover-lock]'),
    lockOnSheet: !!sheet.querySelector('[data-rb-cover-lock]'),
  };
});
check('the handles are still there to be reached, and Lock layout is in the rail',
  reachable.moves === 5 && reachable.resizes === 5 &&
  reachable.lockInRail && !reachable.lockOnSheet,
  JSON.stringify(reachable));

await page.screenshot({ path: `${OUT}/report-sheet-chrome.png` });
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
