/**
 * Pages list: keep scroll position across renderPages, and let lower thumbs
 * be selected (Tim, Nov 23, 2026).
 *
 * Root cause: renderPages emptied #rb-page-list every pass, which resets
 * scrollTop to 0 — scrollbar arrow "goes down then jumps to the top", and
 * slides below the fold cannot stay selectable.
 *
 * Run: node tests/report-pages-scroll-select.mjs  (static server on 8765)
 */
import { createRequire } from 'module';
import { mkdir } from 'fs/promises';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'rb-pages-scroll-select';
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
await page.setViewport({ width: 1400, height: 800, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

await page.evaluate(async (id) => {
  const img = (() => {
    const c = document.createElement('canvas');
    c.width = 640; c.height = 480;
    const x = c.getContext('2d');
    x.fillStyle = '#eee'; x.fillRect(0, 0, 640, 480);
    x.fillStyle = '#333'; x.fillRect(80, 60, 480, 360);
    return c.toDataURL('image/jpeg', 0.85);
  })();
  await window.ToolboxDB.putMedia('plan-scroll-sel', img);
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Ryan'; rec.lastName = 'Haddow';
  rec.propertyAddress = '8511 Calle Norte Trail\nFarmington, NM 87402';
  // Enough levels that the pages list must scroll on an 800px-tall window.
  const names = [
    'Main Floor', 'Covered Patio', 'Garage', 'Basement',
    'Addition', 'Porch', 'Upper East', 'Upper West',
    'Crawlspace', 'Mechanical',
  ];
  rec.planSetup.canvases = names.map((name, i) => ({
    id: 'cv-' + i, name, rooms: [], frontDoorFacing: 'E', frontDoor: null,
    plan: { id: 'plan-scroll-sel', width: 640, height: 480 },
  }));
  rec.distress = { updatedAt: '2026-11-21T12:00:00.000Z', activeCanvasId: 'cv-0', pins: [] };
  rec.planSetup.canvases.forEach((cv, i) => {
    rec.distress.pins.push({
      id: 'pin-' + i, canvasId: cv.id, x: 0.4, y: 0.4,
      description: 'note ' + i, photos: ['ph-' + i],
    });
  });
  rec.floorSurvey = {
    id: 'fs-scroll',
    inspectionDate: '2026-11-21',
    byCanvasId: {},
  };
  rec.planSetup.canvases.forEach((cv) => {
    rec.floorSurvey.byCanvasId[cv.id] = {
      canvasId: cv.id,
      points: [
        { id: 'a', x: 100, y: 100, value: 0 },
        { id: 'b', x: 400, y: 300, value: -1 },
      ],
      areas: [],
      boundary: [{ x: 80, y: 60 }, { x: 560, y: 60 }, { x: 560, y: 420 }, { x: 80, y: 420 }],
    };
  });
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => document.querySelector('.rb-shell')?.getAttribute('data-report-ready') === 'true',
  { timeout: 60000 },
);
await new Promise((r) => setTimeout(r, 1200));

const listInfo = await page.evaluate(() => {
  const list = document.querySelector('#rb-page-list');
  const thumbs = [...document.querySelectorAll('#rb-page-list .rb-thumb')];
  return {
    thumbCount: thumbs.length,
    scrollHeight: list ? list.scrollHeight : 0,
    clientHeight: list ? list.clientHeight : 0,
    canScroll: list ? list.scrollHeight > list.clientHeight + 8 : false,
  };
});
check('Enough thumbs that the pages list can scroll',
  listInfo.canScroll && listInfo.thumbCount >= 8,
  JSON.stringify(listInfo));

// Scroll the list down, then force a re-render by clicking Fit (or a no-op
// re-select path). Measure scrollTop before/after a deliberate renderPages.
const scrolled = await page.evaluate(async () => {
  const list = document.querySelector('#rb-page-list');
  list.scrollTop = Math.min(list.scrollHeight, 220);
  const before = list.scrollTop;
  // Trigger renderPages the way the app does: click a different thumb then
  // would rebuild — instead dispatch by flipping active via the last visible
  // approach: call through a temporary click on thumb 0 then restore scroll
  // ourselves is wrong. Use the status-driven path: toggle draft? Safer:
  // click the currently-inactive Discussion/Cover then back is heavy.
  // Direct: fire click on a thumb that is on-screen after scroll.
  const thumbs = [...list.querySelectorAll('.rb-thumb')];
  const target = thumbs[Math.min(6, thumbs.length - 1)];
  const targetId = target.getAttribute('data-page-id');
  target.click();
  await new Promise((r) => setTimeout(r, 800));
  const after = list.scrollTop;
  const active = list.querySelector('.rb-thumb.is-active');
  return {
    before,
    after,
    targetId,
    activeId: active ? active.getAttribute('data-page-id') : null,
    stayedDown: after >= before - 2 && after > 40,
  };
});
check('Clicking a lower thumb keeps the list scrolled down (no jump to top)',
  scrolled.stayedDown,
  JSON.stringify(scrolled));
check('That lower thumb becomes the active selection',
  scrolled.activeId === scrolled.targetId,
  JSON.stringify(scrolled));

// Scroll further with the scrollbar API, wait for background re-renders
// (legend/autosave can call renderPages), and confirm it stays.
const held = await page.evaluate(async () => {
  const list = document.querySelector('#rb-page-list');
  list.scrollTop = 280;
  const setTo = list.scrollTop;
  await new Promise((r) => setTimeout(r, 2000));
  return { setTo, now: list.scrollTop, held: list.scrollTop >= setTo - 4 && list.scrollTop > 40 };
});
check('Scroll position holds across idle re-renders (~2s)',
  held.held,
  JSON.stringify(held));

// Select another mid-list thumb (not Cover — Cover sits at scrollTop 0 and
// scrollIntoView({nearest}) correctly jumps there when that thumb is chosen).
const arrow = await page.evaluate(async () => {
  const list = document.querySelector('#rb-page-list');
  const thumbs = [...list.querySelectorAll('.rb-thumb')];
  list.scrollTop = 220;
  const mid = list.scrollTop;
  const target = thumbs[Math.min(8, thumbs.length - 1)];
  target.click();
  await new Promise((r) => setTimeout(r, 600));
  return {
    mid,
    now: list.scrollTop,
    activeId: list.querySelector('.rb-thumb.is-active')?.getAttribute('data-page-id'),
    targetId: target.getAttribute('data-page-id'),
    ok: list.scrollTop >= mid - 4 && list.scrollTop > 40,
  };
});
check('After a mid-list selection change, scroll does not reset to 0',
  arrow.ok && arrow.now > 0 && arrow.activeId === arrow.targetId,
  JSON.stringify(arrow));

await page.screenshot({ path: `${OUT}/rb-pages-scroll-select.png` }).catch(() => {});

check('No page errors', pageErrors.length === 0, pageErrors.join(' | '));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
if (failed.length) process.exit(1);
