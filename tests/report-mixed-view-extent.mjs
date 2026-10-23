/**
 * One target page composes the same whatever slide Print was started from.
 *
 * Run: node tests/report-mixed-view-extent.mjs   (static server on 8765)
 *
 * cameraExtentFor measured the drawing frame on the OPEN slide and gave its
 * shape to every imported slide being composed. In a book where one floor
 * page has a single view and another has two side by side, those are
 * different shapes: the same target page came out 889.5 x 666.7 when Main
 * Level was open and 888.9 x 1359.6 when Basement was, from one stored
 * camera. Audit finding 2.
 *
 * It measures the STAGE now -- the sheet less the title rail, the same on
 * every imported slide whatever its slot count -- and applies the target
 * page's own share of it through the frameShare() that lays the frames out.
 * Two views are half of what is left AFTER the gutter, not a naive half, so
 * the gutter is in the answer rather than lost.
 *
 * Four start points are checked, because all four reach different code:
 * a one-view floor page and a two-view floor page take the measurement, and
 * the cover and the discussion have no stage on screen and take the
 * constant.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'rb-mixed-view';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const p = await browser.newPage();
p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
p.on('console', (m) => { const t = m.text(); if (/error|fail|could not|unavailable|warn/i.test(t)) console.log('CONSOLE', t.slice(0, 200)); });
await p.setViewport({ width: 1700, height: 1050, deviceScaleFactor: 1 });
await p.goto(BASE, { waitUntil: 'networkidle0' });

await p.evaluate(async (id) => {
  const plan = (() => {
    const c = document.createElement('canvas'); c.width = 1200; c.height = 900;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 1200, 900);
    x.strokeStyle = '#111'; x.lineWidth = 6; x.strokeRect(30, 30, 1140, 840);
    return c.toDataURL('image/jpeg', 0.92);
  })();
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Mixed'; rec.lastName = 'Views';
  rec.propertyAddress = '15 Rabbitbrush\nSanta Fe County, NM 87506';
  const names = ['Main Level', 'Basement'];
  rec.planSetup.canvases[0].name = names[0];
  rec.planSetup.canvases.push(window.ToolboxPlanSetup.blankCanvas(names[1]));
  const poly = [{ x: 40, y: 40 }, { x: 1160, y: 40 },
    { x: 1160, y: 860 }, { x: 40, y: 860 }];
  const byCanvas = {};
  for (let i = 0; i < rec.planSetup.canvases.length; i += 1) {
    const cv = rec.planSetup.canvases[i]; cv.name = names[i];
    const pid = 'plan-mv-' + i;
    await window.ToolboxDB.putMedia(pid, plan);
    cv.plan = { id: pid, width: 1200, height: 900 };
    cv.frontDoorFacing = 'E';
    const points = []; let n = 0;
    for (let r = 0; r < 3; r += 1) for (let c = 0; c < 4; c += 1) {
      n += 1;
      points.push({ id: 'p' + i + '_' + n, floorId: cv.id, index: n,
        x: 120 + c * 300, y: 150 + r * 280, value: 7 + ((n * 9) % 27) / 10 });
    }
    byCanvas[cv.id] = { canvasId: cv.id, points,
      areas: [{ id: 'a' + i, name: names[i], polygon: poly, createdAt: 1 }],
      boundary: poly };
  }
  rec.floorSurvey = { id: 'fs-mv', inspectionDate: '2026-10-09', byCanvasId: byCanvas };
  rec.reportBuilder = {
    floorCamera: { cx: 0.42, cy: 0.5, zoom: 1.35, rel: true },
    floorLayout: { topo: { x: 4, y: 5, w: 50, h: 89 },
      overview: { x: 2.5, y: 74, w: 16, h: 18 } },
    floorFramed: true,
  };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await p.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await p.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 8000));

// Basement gets two views; Main Level keeps one. That mix is the fault.
const split = await p.evaluate(() => {
  const api = window.__rbTestHooks;
  return !!api;
});
await p.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const doc = rec.reportBuilder || {};
  (doc.pages || []).forEach((pg) => {
    if (pg && pg.type === 'floor' && pg.meta && /Basement/i.test(pg.title || pg.railLabel || '')) {
      pg.meta.floorTwoUp = true;
    }
  });
  rec.reportBuilder = doc;
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);
await p.reload({ waitUntil: 'networkidle0' });
await p.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 8000));

const railLabels = await p.evaluate(() => [...document.querySelectorAll('.rb-thumb')]
  .map((t) => ((t.querySelector('.rb-thumb__caption') || {}).textContent || '').trim()));

const slotCounts = await p.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const out = {};
  ((rec.reportBuilder || {}).pages || []).forEach((pg) => {
    if (pg && pg.type === 'floor') {
      out[pg.title || pg.railLabel || pg.id] = (pg.meta && pg.meta.floorTwoUp) ? 2 : 1;
    }
  });
  return out;
}, FILE);
check('the book holds a one-view page and a two-view page',
  Object.values(slotCounts).some((n) => n === 1) &&
  Object.values(slotCounts).some((n) => n === 2),
  JSON.stringify(slotCounts));

// Open a slide, print, read back the composed figure for the TARGET page.
async function composedFrom(openCaption, targetMatch) {
  await p.evaluate(() => {
    const d = document.querySelector('.rb-print');
    if (d) d.remove();
    document.body.classList.remove('rb-printing');
    window.__printed = false;
    window.print = () => { window.__printed = true; };
  });
  await p.evaluate((cap) => {
    const t = [...document.querySelectorAll('.rb-thumb')].find((x) =>
      new RegExp(cap, 'i').test((x.querySelector('.rb-thumb__caption') || {}).textContent || ''));
    if (t) t.click();
  }, openCaption);
  await new Promise((r) => setTimeout(r, 4000));
  const btn = await p.evaluate(() => {
    const b = document.querySelector('#rb-print');
    return b ? { found: true, disabled: b.disabled, text: (b.textContent||'').trim() } : { found: false };
  });
  console.log('   print button:', JSON.stringify(btn), 'open:', openCaption);
  await p.click('#rb-print');
  await p.waitForFunction(() => window.__printed === true, { timeout: 90000 });
  await new Promise((r) => setTimeout(r, 1200));
  return p.evaluate((tm) => {
    const sheets = [...document.querySelectorAll('.rb-print .rb-sheet')];
    const target = sheets.find((s) =>
      new RegExp(tm, 'i').test(s.getAttribute('aria-label') || ''));
    if (!target) return null;
    const img = target.querySelector('.rb-topo-still');
    if (!img) return null;
    return { w: img.naturalWidth, h: img.naturalHeight,
      aspect: +(img.naturalWidth / img.naturalHeight).toFixed(4) };
  }, targetMatch);
}

const fromMain = await composedFrom('Main Level', 'Basement');
const fromBasement = await composedFrom('Basement', 'Basement');
const fromCover = await composedFrom('Cover', 'Basement');
const fromDiscussion = await composedFrom('Discussion', 'Basement');

const all = { fromMain, fromBasement, fromCover, fromDiscussion };
check('the target page composed from every start point',
  Object.values(all).every((v) => v && v.w > 0), JSON.stringify(all));

const aspects = Object.values(all).filter(Boolean).map((v) => v.aspect);
const spread = aspects.length ? Math.max(...aspects) - Math.min(...aspects) : 99;
check('its shape is the same whichever slide Print was started from',
  spread < 0.01, JSON.stringify(all));

const widths = Object.values(all).filter(Boolean).map((v) => v.w);
const heights = Object.values(all).filter(Boolean).map((v) => v.h);
check('and so are its pixels, within a pixel',
  Math.max(...widths) - Math.min(...widths) <= 1 &&
  Math.max(...heights) - Math.min(...heights) <= 1,
  JSON.stringify({ widths, heights }));

// A two-view frame is half of what is left AFTER the gutter, not a bare half.
const shareMaths = await p.evaluate(() => {
  const fl = window.ToolboxReportFloorLayout;
  return { one: fl.frameShare(1), two: fl.frameShare(2), gutter: fl.FRAME_GUTTER };
});
check('one view takes the whole stage', shareMaths.one === 100, JSON.stringify(shareMaths));
check('two views are half of what the gutter leaves, not half the stage',
  shareMaths.two === 49, `${shareMaths.two}% each with a ${shareMaths.gutter}% gutter`);

// And the single-view page is still right.
const mainFromMain = await composedFrom('Main Level', 'Main Level');
const mainFromBasement = await composedFrom('Basement', 'Main Level');
check('the one-view page is also start-point independent',
  !!mainFromMain && !!mainFromBasement &&
  Math.abs(mainFromMain.aspect - mainFromBasement.aspect) < 0.01,
  JSON.stringify({ mainFromMain, mainFromBasement }));
check('and it is wider than the two-view page, by about the share',
  !!mainFromMain && !!fromMain &&
  mainFromMain.aspect > fromMain.aspect * 1.8,
  JSON.stringify({ oneView: mainFromMain && mainFromMain.aspect,
    twoView: fromMain && fromMain.aspect }));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
