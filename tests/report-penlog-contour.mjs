/**
 * The contour layer on a Picture Locations sheet.
 * Run: node tests/report-penlog-contour.mjs   (needs a static server on 8765)
 *
 * Floor Survey writes a black-and-white contour of a level as a second layer
 * on it, and Distress draws the damage pins over it. Tim, after taking it
 * round a real job: "this is most likely going to be the view in Report
 * Builder more often than not, because it's very telling." So a Picture
 * Locations sheet draws it wherever the level has one.
 *
 * It is a rendition of the page, not a change to anything: the level keeps
 * its layer, Distress keeps whatever it is showing, and the sheet keeps the
 * same plan, pins and numbers. Each sheet carries its own choice, and the
 * button only appears on a level that actually has a contour.
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
const FILE = 'rb-penlog-contour';
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

await page.evaluate(async (id) => {
  const paint = (kind) => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    const ctx = canvas.getContext('2d');
    if (kind === 'plan') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 800, 600);
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 5;
      ctx.strokeRect(40, 40, 720, 520);
    } else {
      // Transparent, as Floor Survey writes it, with lines in one colour
      // nothing else on the sheet uses.
      ctx.clearRect(0, 0, 800, 600);
      ctx.strokeStyle = '#00a000';
      ctx.lineWidth = 6;
      for (let i = 0; i < 6; i += 1) {
        ctx.beginPath();
        ctx.ellipse(400, 300, 60 + i * 50, 40 + i * 36, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    return canvas.toDataURL('image/png');
  };
  await window.ToolboxDB.putMedia('plan-pc', paint('plan'));
  await window.ToolboxDB.putMedia('contour-pc', paint('contour'));

  const record = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(record);
  record.firstName = 'Owen';
  record.lastName = 'Beck';
  record.propertyAddress = '9 Contour Court\nSanta Fe, NM 87505';
  const first = record.planSetup.canvases[0];
  first.name = 'Main Level';
  first.plan = { id: 'plan-pc', width: 800, height: 600 };
  first.contourLayer = {
    id: 'contour-pc',
    width: 800,
    height: 600,
    createdAt: new Date().toISOString(),
    surveyDate: '2026-10-01',
    pointCount: 20,
    areaName: 'Main Level',
  };
  // A second level with no contour of its own, so the button has somewhere
  // not to appear.
  const bare = {
    id: 'canvas-bare',
    name: 'Basement',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    plan: { id: 'plan-pc', width: 800, height: 600 },
    rooms: [],
    frontDoorFacing: 'N',
    frontDoor: null,
  };
  record.planSetup.canvases.push(bare);

  const pins = [];
  for (let i = 1; i <= 4; i += 1) {
    await window.ToolboxDB.putMedia('ph-pc-' + i, paint('plan'));
    pins.push({
      id: 'pin-' + i, num: i, x: 0.2 + i * 0.12, y: 0.3 + (i % 3) * 0.15,
      canvasId: i <= 3 ? first.id : bare.id,
      location: 'Room ' + i, description: 'Crack ' + i,
      photos: [{ id: 'ph-pc-' + i }],
    });
  }
  record.distress = {
    mode: 'internal', startNum: 1, nextNum: 5, activeCanvasId: first.id, pins,
  };
  await window.ToolboxDB.saveCustomerFile(record);
}, FILE);

/** Open the nth Picture Locations sheet. */
async function openPenLog(index) {
  await page.waitForFunction(
    () => document.querySelectorAll('.rb-thumb[data-page-id^="distress-"]').length >= 1,
    { timeout: 25000 });
  const id = await page.evaluate((n) => {
    const thumbs = [...document.querySelectorAll('.rb-thumb[data-page-id^="distress-"]')];
    const thumb = thumbs[n];
    if (!thumb) return '';
    thumb.click();
    return thumb.getAttribute('data-page-id') || '';
  }, index);
  await page.waitForFunction(
    (want) => document.querySelector('.rb-sheet')?.getAttribute('data-page-id') === want,
    { timeout: 15000 }, id);
  await page.waitForFunction(
    () => !!document.querySelector('.rb-sheet:not(.rb-sheet--thumb) .rb-penlog'),
    { timeout: 15000 });
  return id;
}

const sheetNow = () => page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
  const contour = sheet.querySelector('.rb-penlog__image--contour');
  const button = document.querySelector('#rb-penlog-contour');
  return {
    plan: !!sheet.querySelector('.rb-penlog__image:not(.rb-penlog__image--contour)'),
    contour: !!contour,
    contourSrc: contour ? (contour.getAttribute('src') || '').slice(0, 11) : '',
    pins: sheet.querySelectorAll('.rb-penlog__pin').length,
    button: button && !button.hidden ? button.textContent.trim() : '',
  };
});

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await openPenLog(0);

const on = await sheetNow();
check('a level with a contour draws it over the plan, under the pins',
  on.plan && on.contour && on.contourSrc === 'data:image/' && on.pins === 3, JSON.stringify(on));
check('and the panel says so', on.button === 'Contours on', JSON.stringify(on));

// The pins and their numbers are the sheet's, not the layer's: turning the
// contour off changes the drawing and nothing else.
await page.evaluate(() => document.querySelector('#rb-penlog-contour').click());
await page.waitForFunction(
  () => !document.querySelector('.rb-sheet:not(.rb-sheet--thumb) .rb-penlog__image--contour'),
  { timeout: 15000 });
await page.waitForFunction(
  () => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''), { timeout: 15000 });
const off = await sheetNow();
check('turning it off leaves the plan and every pin where they were',
  off.plan && !off.contour && off.pins === on.pins && off.button === 'Contours off',
  JSON.stringify(off));

const stored = await page.evaluate(async (id) => {
  const record = await window.ToolboxDB.getCustomerFile(id);
  const sheet = (record.reportBuilder?.pages || []).find((p) => p.type === 'distress');
  const canvas = (record.planSetup?.canvases || [])[0];
  return {
    showContour: sheet?.meta?.showContour,
    levelStillHasLayer: !!(canvas && canvas.contourLayer && canvas.contourLayer.id),
  };
}, FILE);
check('the choice is the page’s and the level keeps its layer',
  stored.showContour === false && stored.levelStillHasLayer, JSON.stringify(stored));

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await openPenLog(0);
const reopened = await sheetNow();
check('and it is still off after coming back',
  !reopened.contour && reopened.button === 'Contours off', JSON.stringify(reopened));

// The other level has no contour, so it is offered none.
await openPenLog(1);
const bare = await sheetNow();
check('a level without a contour is offered no button',
  bare.plan && !bare.contour && bare.button === '', JSON.stringify(bare));

await page.screenshot({ path: `${OUT}/report-penlog-contour.png` });
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
