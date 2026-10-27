/**
 * Capture Excel secondary-tab screenshots for Tim / GPT on #136.
 * Run: node tests/report-floor-subtabs-shots.mjs  (static server on 8765)
 */
import { createRequire } from 'module';
import { mkdir, writeFile } from 'fs/promises';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
const FILE = 'rb-subtabs-shots';

await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

async function openTask(which) {
  await page.evaluate((w) => document.querySelector(`[data-rb-floor-task="${w}"]`)?.click(), which);
  await new Promise((r) => setTimeout(r, 600));
}

async function openSub(which) {
  await page.evaluate((w) => document.querySelector(`[data-rb-rail-tab="${w}"]`)?.click(), which);
  await new Promise((r) => setTimeout(r, 400));
}

async function shotRailCloseup(name) {
  const box = await page.evaluate(() => {
    const rail = document.querySelector('#rb-rail');
    if (!rail) return null;
    const r = rail.getBoundingClientRect();
    const tabs = document.querySelector('.rb-ws__task-tabs');
    const sub = document.querySelector('.rb-ws__sub-nav') || document.querySelector('.rb-ws__sub-tabs');
    const panel = document.querySelector('.rb-ws__sub-panel');
    const top = Math.max(0, (tabs?.getBoundingClientRect().top ?? r.top) - 8);
    const bottom = Math.min(
      r.bottom,
      Math.max(
        sub?.getBoundingClientRect().bottom ?? 0,
        panel?.getBoundingClientRect().top ?? 0,
      ) + 120,
    );
    return {
      x: Math.max(0, r.left - 4),
      y: top,
      width: Math.min(r.width + 8, 420),
      height: Math.max(160, bottom - top),
    };
  });
  if (!box) throw new Error('no rail for ' + name);
  await page.screenshot({
    path: `${OUT}/${name}.png`,
    clip: {
      x: Math.floor(box.x),
      y: Math.floor(box.y),
      width: Math.ceil(box.width),
      height: Math.ceil(box.height),
    },
  });
  console.log('wrote', name, box);
}

await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.evaluate(async (id) => {
  const c = document.createElement('canvas');
  c.width = 800; c.height = 600;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 800, 600);
  x.strokeStyle = '#111'; x.strokeRect(20, 20, 760, 560);
  x.fillStyle = '#c14a2b';
  for (let i = 1; i <= 6; i += 1) x.fillRect(100 + i * 80, 190, 12, 12);
  await window.ToolboxDB.putMedia('plan-subtabs', c.toDataURL('image/jpeg', 0.9));
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Subtabs'; rec.lastName = 'Probe';
  rec.propertyAddress = '2 Tab Lane';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Main Level';
  cv.plan = { id: 'plan-subtabs', width: 800, height: 600 };
  cv.frontDoorFacing = 'N';
  const poly = [{ x: 40, y: 40 }, { x: 760, y: 40 }, { x: 760, y: 560 }, { x: 40, y: 560 }];
  const points = [];
  for (let i = 1; i <= 6; i += 1) {
    points.push({ id: 't' + i, floorId: cv.id, index: i, x: 100 + i * 80, y: 200, value: 5 + i * 0.3 });
  }
  rec.floorSurvey = {
    id: 'fs-subtabs', inspectionDate: '2026-10-26',
    byCanvasId: {
      [cv.id]: {
        canvasId: cv.id, points,
        areas: [{ id: 'a1', name: 'Main Level', polygon: poly, createdAt: 1 }],
        boundary: poly,
      },
    },
  };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 5000));
await page.evaluate(() => {
  const t = [...document.querySelectorAll('.rb-thumb[data-page-id^="floor-"]')]
    .find((el) => !/reserved/i.test(el.getAttribute('data-page-id') || ''))
    || [...document.querySelectorAll('.rb-thumb[data-page-id^="floor-"]')][0];
  t?.click();
});
await page.waitForFunction(
  () => !!document.querySelector('[data-rb-floor-import]') ||
    !!document.querySelector('[data-rb-floor-box^="topo"]') ||
    !!document.querySelector('[data-rb-floor-task]'),
  { timeout: 25000 });
const needsImport = await page.evaluate(() => {
  const btn = document.querySelector('[data-rb-floor-import]');
  if (!btn) return false;
  btn.click();
  return true;
});
if (needsImport) {
  await page.waitForFunction(
    () => !!document.querySelector('[data-rb-floor-box^="topo"]') ||
      !!document.querySelector('[data-rb-floor-task]'),
    { timeout: 30000 });
}
await new Promise((r) => setTimeout(r, 2200));
await openTask('topo');
await page.waitForFunction(() => !!document.querySelector('.rb-ws__sub-tab'), { timeout: 20000 });
await new Promise((r) => setTimeout(r, 800));

await openSub('contours');
await shotRailCloseup('rb-subtabs-closeup-contours-1440');
await page.screenshot({ path: `${OUT}/rb-subtabs-full-contours-1440.png`, fullPage: false });

await openSub('readings');
await shotRailCloseup('rb-subtabs-closeup-readings-1440');
await page.screenshot({ path: `${OUT}/rb-subtabs-full-readings-1440.png`, fullPage: false });

await openSub('legendhl');
await shotRailCloseup('rb-subtabs-closeup-legend-1440');
await page.screenshot({ path: `${OUT}/rb-subtabs-full-legend-1440.png`, fullPage: false });

await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
await new Promise((r) => setTimeout(r, 600));
await openSub('contours');
await shotRailCloseup('rb-subtabs-closeup-contours-1920');
await page.screenshot({ path: `${OUT}/rb-subtabs-full-contours-1920.png`, fullPage: false });
await openSub('readings');
await shotRailCloseup('rb-subtabs-closeup-readings-1920');
await openSub('legendhl');
await shotRailCloseup('rb-subtabs-closeup-legend-1920');
await page.screenshot({ path: `${OUT}/rb-subtabs-full-legend-1920.png`, fullPage: false });

const meta = await page.evaluate(() => ({
  primary: [...document.querySelectorAll('[data-rb-floor-task]')].map((b) => ({
    t: b.textContent.trim(), active: b.classList.contains('is-active'),
  })),
  secondary: [...document.querySelectorAll('[data-rb-rail-tab]')].map((b) => ({
    t: b.textContent.trim(),
    active: b.classList.contains('is-active') || b.getAttribute('aria-selected') === 'true',
    cls: b.className,
  })),
  identityParent: !!document.querySelector('[data-rb-topo-identity] .rb-panel__lead, [data-rb-topo-identity] [data-rb-floor-topo-lead]'),
}));
await writeFile(`${OUT}/rb-subtabs-shots.json`, JSON.stringify(meta, null, 2));
console.log(JSON.stringify(meta, null, 2));
await browser.close();
console.log('done');
