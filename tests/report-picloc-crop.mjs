/**
 * Right-click Crop and Restore on a Picture Locations plan (Tim, Nov 23, 2026).
 *
 * Run: node tests/report-picloc-crop.mjs   (static server on 8765)
 *
 * Same idea as Floor Survey's report-plan-crop: Crop frames the drawing by
 * setting a per-level camera; Restore puts the whole plan back; the crop
 * survives a reload.
 */
import { createRequire } from 'module';
import { mkdir } from 'fs/promises';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'rb-picloc-crop';
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
await page.setViewport({ width: 1700, height: 1050, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

// Unit: cameraFrame at default matches contained fit; crop zooms.
const unit = await page.evaluate(() => {
  const api = window.ToolboxPenLog;
  const fit = api.containedFrame(800, 600, 1600, 900);
  const cam0 = api.cameraFrame(800, 600, 1600, 900, { cx: 0.5, cy: 0.5, zoom: 1, rel: true });
  const cam2 = api.cameraFrame(800, 600, 1600, 900, { cx: 0.5, cy: 0.5, zoom: 2, rel: true });
  return {
    match: Math.abs(fit.x - cam0.x) < 0.5 && Math.abs(fit.width - cam0.width) < 0.5,
    zoomedBigger: cam2.width > cam0.width * 1.5,
    zoom: cam2.camera.zoom,
  };
});
check('Default camera matches the ordinary contained fit', unit.match, JSON.stringify(unit));
check('Zoom 2 draws the plan larger in the same box', unit.zoomedBigger, JSON.stringify(unit));

await page.evaluate(async (id) => {
  const img = (() => {
    const c = document.createElement('canvas');
    c.width = 1600; c.height = 1200;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 1600, 1200);
    // Drawing sits in the middle third — white margin around it.
    x.fillStyle = '#111';
    x.fillRect(480, 360, 640, 480);
    x.fillStyle = '#fff';
    x.fillRect(500, 380, 600, 440);
    x.strokeStyle = '#222'; x.lineWidth = 8; x.strokeRect(500, 380, 600, 440);
    return c.toDataURL('image/jpeg', 0.92);
  })();
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Haddow'; rec.lastName = 'Crop';
  rec.propertyAddress = '8511 Calle Norte Trail\nFarmington, NM 87402';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Main Level';
  await window.ToolboxDB.putMedia('plan-picloc-crop', img);
  cv.plan = { id: 'plan-picloc-crop', width: 1600, height: 1200 };
  const pins = [];
  for (let i = 0; i < 6; i += 1) {
    pins.push({
      id: 'pin-' + (i + 1),
      canvasId: cv.id,
      x: 0.35 + (i % 3) * 0.1,
      y: 0.4 + Math.floor(i / 3) * 0.12,
      description: i === 0 ? 'Garage' : 'Crack',
      photos: ['ph-' + (i + 1)],
    });
  }
  rec.distress = {
    updatedAt: '2026-10-09T12:00:00.000Z',
    activeCanvasId: cv.id,
    pins: pins,
  };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet:not(.rb-sheet--thumb)'), { timeout: 40000 });
await page.evaluate(() => {
  const thumb = [...document.querySelectorAll('.rb-thumb')]
    .find((t) => /^distress-/.test(t.getAttribute('data-page-id') || ''));
  thumb?.click();
});
await new Promise((r) => setTimeout(r, 3500));
check('A Picture Locations thumb is in the rail',
  await page.evaluate(() => !!document.querySelector('.rb-thumb[data-page-id^="distress-"]')));

const planBox = await page.evaluate(() => {
  const el = document.querySelector('.rb-stage .rb-sheet:not(.rb-sheet--thumb) .rb-penlog__plan');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
});
check('The plan is on the Picture Locations sheet', !!planBox, JSON.stringify(planBox));

const fitBefore = await page.evaluate(() => {
  const fit = document.querySelector('.rb-stage .rb-sheet:not(.rb-sheet--thumb) .rb-penlog__fit');
  if (!fit) return null;
  return { w: fit.offsetWidth, h: fit.offsetHeight };
});

await page.mouse.click(planBox.x, planBox.y, { button: 'right' });
await new Promise((r) => setTimeout(r, 400));
const items = await page.evaluate(() =>
  [...document.querySelectorAll('[data-rb-stackmenu] button')].map((b) => b.textContent.trim()));
check('Right-click on the plan offers Crop and Restore beside stacking',
  ['Crop', 'Restore', 'Bring to front', 'Send to back'].every((n) => items.includes(n)),
  items.join('|'));

await page.evaluate(() => document.querySelector('[data-rb-menu="crop"]').click());
await new Promise((r) => setTimeout(r, 2500));

const savedCamera = () => page.evaluate(async (id) => {
  const r = await ToolboxDB.getCustomerFile(id);
  const doc = r.reportBuilder || r.report || {};
  const cams = doc.penLogCameras || {};
  const keys = Object.keys(cams);
  return keys.length ? cams[keys[0]] : null;
}, FILE);

let cam = await savedCamera();
check('Crop sets a per-level camera zoomed in on the drawing', cam && cam.zoom > 1.2, JSON.stringify(cam));
check('and centred near the drawing', cam && Math.abs(cam.cx - 0.5) < 0.15 && Math.abs(cam.cy - 0.5) < 0.15,
  cam && (cam.cx + ',' + cam.cy));

const fitAfter = await page.evaluate(() => {
  const fit = document.querySelector('.rb-stage .rb-sheet:not(.rb-sheet--thumb) .rb-penlog__fit');
  const plan = document.querySelector('.rb-stage .rb-sheet:not(.rb-sheet--thumb) .rb-penlog__plan');
  if (!fit || !plan) return null;
  return {
    w: fit.offsetWidth,
    h: fit.offsetHeight,
    cropped: plan.classList.contains('is-cropped'),
    zoomAttr: plan.getAttribute('data-rb-camera-zoom'),
  };
});
check('The fitted plan is larger after Crop',
  fitBefore && fitAfter && fitAfter.w > fitBefore.w * 1.15,
  JSON.stringify({ fitBefore, fitAfter }));
check('The plan box clips while cropped', fitAfter && fitAfter.cropped, JSON.stringify(fitAfter));

await page.screenshot({ path: `${OUT}/picloc-crop-after.png` }).catch(() => {});

// Persists across reload
await page.goto('about:blank');
await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 5000));
cam = await savedCamera();
check('The crop is still there after a reload', cam && cam.zoom > 1.2, JSON.stringify(cam));

await page.evaluate(() => {
  const thumb = [...document.querySelectorAll('.rb-thumb')]
    .find((t) => /^distress-/.test(t.getAttribute('data-page-id') || ''));
  thumb?.click();
});
await new Promise((r) => setTimeout(r, 3500));
const planBox2 = await page.evaluate(() => {
  const el = document.querySelector('.rb-stage .rb-sheet:not(.rb-sheet--thumb) .rb-penlog__plan');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
check('Plan still on sheet for Restore', !!planBox2, JSON.stringify(planBox2));
await page.mouse.click(planBox2.x, planBox2.y, { button: 'right' });
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => document.querySelector('[data-rb-menu="restore"]').click());
await new Promise((r) => setTimeout(r, 2500));
cam = await savedCamera();
check('Restore clears the stored crop (whole plan again)', !cam || cam.zoom === 1, JSON.stringify(cam));
const restored = await page.evaluate(() => {
  const plan = document.querySelector('.rb-stage .rb-sheet:not(.rb-sheet--thumb) .rb-penlog__plan');
  return plan && !plan.classList.contains('is-cropped');
});
check('The plan is no longer marked cropped on screen', restored);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
if (failed.length) process.exit(1);
