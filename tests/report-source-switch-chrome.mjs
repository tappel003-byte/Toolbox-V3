/**
 * Switching a floor sheet's source from Combined to one boundary leaves one scale and one pill (Tim, Nov 25, 2026).
 *
 * Haddow-shaped job: one canvas "Floor Plan" with named areas Main Floor / 3 Car Garage / Covered Patio, and a
 * Combined sheet. Changing its View source to one boundary used to leave a scale and a pill for every boundary.
 *
 * Run: node tests/report-source-switch-chrome.mjs  (static server on 8765)
 */
import { createRequire } from 'module';
import { mkdir } from 'fs/promises';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'rb-source-switch-chrome';
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
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
await page.setCacheEnabled(false);
await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  for (const r of regs) await r.unregister();
  const keys = await caches.keys();
  for (const k of keys) await caches.delete(k);
});
await page.goto(BASE + '?v=main-floor-fix', { waitUntil: 'networkidle0' });

await page.evaluate(async (id) => {
  const img = (() => {
    const c = document.createElement('canvas');
    c.width = 1000; c.height = 750;
    const x = c.getContext('2d');
    x.fillStyle = '#f0ebe3'; x.fillRect(0, 0, 1000, 750);
    x.fillStyle = '#222'; x.fillRect(40, 40, 920, 670);
    return c.toDataURL('image/jpeg', 0.9);
  })();
  await ToolboxDB.putMedia('plan-main-floor-fix', img);
  const rec = ToolboxApp.blankCustomerFile(id);
  ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Ryan'; rec.lastName = 'Haddow';
  rec.propertyAddress = '8511 Calle Norte Trail\nFarmington, NM 87402';
  rec.planSetup.canvases = [
    { id: 'cv-plan', name: 'Floor Plan', rooms: [], frontDoorFacing: 'E', frontDoor: null,
      plan: { id: 'plan-main-floor-fix', width: 1000, height: 750 } },
  ];
  const pts = [
    { id: 'm1', x: 150, y: 150, value: 0 },
    { id: 'm2', x: 350, y: 180, value: 1.0 },
    { id: 'm3', x: 400, y: 350, value: -0.5 },
    { id: 'g1', x: 700, y: 150, value: 0.8 },
    { id: 'g2', x: 850, y: 200, value: -0.2 },
    { id: 'g3', x: 800, y: 350, value: 0.4 },
    { id: 'p1', x: 200, y: 550, value: 0.2 },
    { id: 'p2', x: 500, y: 580, value: -0.8 },
    { id: 'p3', x: 750, y: 560, value: 0.1 },
  ];
  rec.floorSurvey = {
    id: 'fs-main-floor-fix',
    inspectionDate: '2025-11-21',
    byCanvasId: {
      'cv-plan': {
        canvasId: 'cv-plan',
        points: pts,
        boundary: [
          { x: 40, y: 40 }, { x: 960, y: 40 }, { x: 960, y: 710 }, { x: 40, y: 710 },
        ],
        areas: [
          { id: 'area-main', name: 'Main Floor',
            polygon: [{ x: 40, y: 40 }, { x: 520, y: 40 }, { x: 520, y: 450 }, { x: 40, y: 450 }] },
          { id: 'area-gar', name: '3 Car Garage',
            polygon: [{ x: 520, y: 40 }, { x: 960, y: 40 }, { x: 960, y: 450 }, { x: 520, y: 450 }] },
          { id: 'area-patio', name: 'Covered Patio',
            polygon: [{ x: 40, y: 450 }, { x: 960, y: 450 }, { x: 960, y: 710 }, { x: 40, y: 710 }] },
        ],
      },
    },
  };
  await ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}?v=seed#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => document.querySelector('.rb-shell')?.getAttribute('data-report-ready') === 'true',
  { timeout: 90000 },
);
await new Promise((r) => setTimeout(r, 3000));

const boxes = () => page.evaluate(() => [...document.querySelectorAll('.rb-sheet [data-rb-floor-box]')].map((b) => b.getAttribute('data-rb-floor-box')));
const chrome = (list) => list.filter((b) => /^(legend|pill)-/.test(b));
const pick = (re) => page.evaluate((src) => { const s = document.querySelector('[data-rb-floor-view-source]'); const o = [...s.options].find((x) => new RegExp(src).test(x.textContent)); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); }, re);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await page.evaluate(() => document.querySelector('.rb-thumb[data-page-id$="::all"]').click());
await wait(4000);
await page.evaluate(() => document.querySelector('[data-rb-floor-task="layout"]')?.click());
await wait(800);
check('A Combined sheet carries no colour scales or H/L/delta pills', chrome(await boxes()).length === 0, JSON.stringify(await boxes()));
await pick('Main Floor'); await wait(4500);
const main = chrome(await boxes());
check('Switching Combined to Main Floor leaves one scale and one pill, not one per boundary', main.length === 2 && main.includes('legend-0') && main.includes('pill-0'), JSON.stringify(main));
await pick('Combined'); await wait(4500);
check('Switching back to Combined takes them off again', chrome(await boxes()).length === 0, JSON.stringify(await boxes()));
check('No page errors', pageErrors.length === 0, pageErrors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
