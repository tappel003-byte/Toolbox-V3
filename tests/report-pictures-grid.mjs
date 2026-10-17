/**
 * A Pictures page is laid out on a grid that fits it.
 * Run: node tests/report-pictures-grid.mjs   (needs a static server on 8765)
 *
 * Eleven photographs make a full page and then a page holding one, and that
 * one used to be drawn five across like any other: a single picture a fifth
 * of a row wide, marooned in the corner of an empty sheet. Tim: "it just
 * strands a photo... if we have 10 pictures per slide and we can change our
 * grid to 5 by 2 or 4 by 2 or 4 by 1, 5 by 1, then it would probably look
 * less improper."
 *
 * So a page starts on the grid that fits what it holds -- one picture fills
 * its sheet -- and the rail offers the others by the grid they make rather
 * than by a column count.
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
const FILE = 'rb-pics-grid';
const PHOTOS = 11;
const results = [];
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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

await page.evaluate(async ({ png, id, count }) => {
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
  record.firstName = 'Nora';
  record.lastName = 'Vance';
  record.propertyAddress = '11 Picture Row';
  const canvasId = record.planSetup.canvases[0].id;
  await window.ToolboxDB.putMedia('plan-grid', png);
  record.planSetup.canvases[0].plan = { id: 'plan-grid', width: 400, height: 300 };

  const pins = [];
  for (let i = 1; i <= count; i += 1) {
    const photoId = 'ph-grid-' + i;
    await window.ToolboxDB.putMedia(photoId, png);
    pins.push({
      id: 'pin-' + i,
      num: i,
      x: 0.1 + (i % 7) * 0.1,
      y: 0.1 + (i % 5) * 0.15,
      canvasId,
      location: 'Room ' + i,
      description: 'Observation ' + i,
      photos: [{ id: photoId }],
    });
  }
  record.distress = {
    mode: 'internal', startNum: 1, nextNum: count + 1, activeCanvasId: canvasId, pins,
  };
  await window.ToolboxDB.saveCustomerFile(record);
}, { png: TINY_PNG, id: FILE, count: PHOTOS });

async function openReport() {
  await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(
    () => document.querySelectorAll('.rb-thumb[data-page-id^="pictures-"]').length >= 2,
    { timeout: 25000 });
}

/** Open the nth Pictures sheet and read the grid it is laid out on. */
async function picturesSheet(index) {
  const id = await page.evaluate((n) => {
    const thumbs = [...document.querySelectorAll('.rb-thumb[data-page-id^="pictures-"]')];
    const thumb = thumbs[n];
    if (!thumb) return '';
    thumb.click();
    return thumb.getAttribute('data-page-id') || '';
  }, index);
  await page.waitForFunction(
    (want) => document.querySelector('.rb-sheet')?.getAttribute('data-page-id') === want,
    { timeout: 15000 }, id);
  await page.waitForFunction(
    () => !!document.querySelector('.rb-sheet:not(.rb-sheet--thumb) .rb-pictures-page__grid'),
    { timeout: 15000 });
  return page.evaluate(() => {
    const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
    const grid = sheet.querySelector('.rb-pictures-page__grid');
    const cells = [...sheet.querySelectorAll('.rb-pictures-page__cell')];
    const cell = cells[0] ? cells[0].getBoundingClientRect() : null;
    const sheetBox = sheet.getBoundingClientRect();
    return {
      cols: Number(grid.style.getPropertyValue('--rb-pics-cols')),
      rows: Number(grid.style.getPropertyValue('--rb-pics-rows')),
      cells: cells.length,
      cellShare: cell ? Math.round((cell.width / sheetBox.width) * 100) : 0,
      buttons: [...document.querySelectorAll('[data-rb-pics-across]')].map((b) => b.textContent.trim()),
    };
  });
}

await openReport();

const full = await picturesSheet(0);
check('a full page is still five across and two down',
  full.cells === 10 && full.cols === 5 && full.rows === 2, JSON.stringify(full));
check('the rail names each choice by the grid it makes',
  full.buttons.join(' | ') === '1 × 10 | 2 × 5 | 3 × 4 | 4 × 3 | 5 × 2', full.buttons.join(' | '));

const last = await picturesSheet(1);
check('the page holding one photograph is not drawn five across',
  last.cells === 1 && last.cols === 1 && last.rows === 1, JSON.stringify(last));
check('that photograph fills its sheet instead of sitting in the corner',
  last.cellShare > 50, JSON.stringify(last));
check('and a page of one offers no grid to change it to',
  last.buttons.join(' | ') === '1 × 1', last.buttons.join(' | '));

// A grid chosen by hand is the grid that is kept.
await picturesSheet(0);
await page.evaluate(() => document.querySelector('[data-rb-pics-across="4"]').click());
await page.waitForFunction(
  () => Number(document.querySelector('.rb-sheet:not(.rb-sheet--thumb) .rb-pictures-page__grid')
    .style.getPropertyValue('--rb-pics-cols')) === 4, { timeout: 15000 });
await page.waitForFunction(
  () => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''), { timeout: 15000 });

await openReport();
const chosen = await picturesSheet(0);
check('a grid chosen by hand survives leaving and coming back',
  chosen.cols === 4 && chosen.rows === 3, JSON.stringify(chosen));

// A long description is printed whole. The caption box used to stop at a
// little under four lines and scroll, so what the investigator wrote read
// complete on screen and printed with its end missing.
const LONG = 'Hairline crack in the ceiling drywall running east to west, roughly four ' +
  'feet long and widening toward the exterior wall, with a secondary branch above the ' +
  'window header that continues into the corner bead and appears to follow the framing line.';
await picturesSheet(0);
await page.evaluate((text) => {
  const field = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-caption]');
  field.value = text;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}, LONG);
await new Promise((r) => setTimeout(r, 600));
const caption = await page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
  const field = sheet.querySelector('[data-rb-caption]');
  const sr = sheet.getBoundingClientRect();
  const past = [...sheet.querySelectorAll('.rb-pictures-page__cell *')]
    .filter((el) => el.getBoundingClientRect().bottom > sr.bottom + 1).length;
  return {
    cut: field.scrollHeight - field.clientHeight,
    lines: Math.round(field.clientHeight / parseFloat(getComputedStyle(field).lineHeight)),
    past,
    overflow: sheet.scrollHeight - Math.round(sr.height),
  };
});
check('a long description is shown whole, not cut off at four lines',
  caption.cut <= 1 && caption.lines > 4, JSON.stringify(caption));
check('and nothing it pushed runs off the paper',
  caption.past === 0 && caption.overflow <= 1, JSON.stringify(caption));

await page.screenshot({ path: `${OUT}/report-pictures-grid.png` });
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
