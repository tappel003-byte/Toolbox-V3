/**
 * The drawing moves, on every slide, in every report.
 *
 * Run: node tests/report-floor-drawing-movable.mjs   (static server on 8765)
 *
 * Lock layout used to set floorCamera.locked, and that flag travels all the
 * way to PlanCanvas as `frozen` -- which stops the pan AND takes away the
 * corner handles (TopoTab: frozen={locked}, resizeCorners={resizeCorners &&
 * !locked}).
 *
 * Removing the Lock button left the flag behind. Any report saved while it
 * was on opened with a drawing that could not be moved or resized and no
 * control left to release it. Tim: "We also cannot move the topo", "I cannot
 * resize the picture. Or the topo."
 *
 * There is no lock now, so the flag is dropped on the way in and never sent
 * to the view.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE = 'rb-movable';
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
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.setViewport({ width: 1700, height: 1050, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

await page.evaluate(async (id) => {
  const plan = (() => {
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 900;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 1200, 900);
    x.strokeStyle = '#111'; x.lineWidth = 6; x.strokeRect(30, 30, 1140, 840);
    return c.toDataURL('image/jpeg', 0.92);
  })();
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Movable'; rec.lastName = 'Drawing';
  rec.propertyAddress = '15 Rabbitbrush\nSanta Fe County, NM 87506';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Main Level';
  await window.ToolboxDB.putMedia('plan-movable', plan);
  cv.plan = { id: 'plan-movable', width: 1200, height: 900 };
  cv.frontDoorFacing = 'E';
  const poly = [{ x: 40, y: 40 }, { x: 1160, y: 40 }, { x: 1160, y: 860 }, { x: 40, y: 860 }];
  const points = [];
  let n = 0;
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      n += 1;
      points.push({ id: 'p' + n, floorId: cv.id, index: n,
        x: 120 + c * 300, y: 150 + r * 280, value: 7 + ((n * 9) % 27) / 10 });
    }
  }
  rec.floorSurvey = { id: 'fs-movable', inspectionDate: '2026-10-09', byCanvasId: {
    [cv.id]: { canvasId: cv.id, points,
      areas: [{ id: 'a0', name: 'Main Level', polygon: poly, createdAt: 1 }],
      boundary: poly },
  } };
  // A report saved while Lock layout existed.
  rec.reportBuilder = { floorCamera: { cx: 0.5, cy: 0.5, zoom: 1.2, rel: true, locked: true } };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 7000));
const at = await page.evaluate(() => [...document.querySelectorAll('.rb-thumb')]
  .findIndex((t) => /Main Level/i.test((t.querySelector('.rb-thumb__caption') || {}).textContent || '')));
check('the job made a Main Level sheet', at >= 0, String(at));
await page.evaluate((n) => document.querySelectorAll('.rb-thumb')[n].click(), at);
await new Promise((r) => setTimeout(r, 5000));

check('the drawing is not frozen by a lock that no longer exists',
  await page.evaluate(() => !document.querySelector('.rb-sheet:not(.rb-sheet--thumb) .rtw-root--locked')),
  'rtw-root--locked present');

// Drag inside the drawing. That is Floor Survey's pan, not a frame move.
const host = await page.evaluate(() => {
  const el = document.querySelector('.rb-stage .rb-sheet [data-rb-topo-live]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
check('the slide is holding a live drawing', !!host, JSON.stringify(host));
await page.mouse.move(host.x, host.y);
await page.mouse.down();
await page.mouse.move(host.x - 160, host.y - 90, { steps: 14 });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 1500));

await page.waitForFunction(
  () => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''),
  { timeout: 20000 }).catch(() => {});
const stored = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  return (rec && rec.reportBuilder && rec.reportBuilder.floorCamera) || null;
}, FILE);

check('panning the drawing moved the shared floorCamera',
  !!stored && (Math.abs(stored.cx - 0.5) > 0.005 || Math.abs(stored.cy - 0.5) > 0.005),
  JSON.stringify(stored));
check('and the stale lock is gone from the saved report',
  !!stored && !stored.locked, JSON.stringify(stored));

// GPT-028: an untouched ordinary sibling figure consumes the shared camera.
// Duplicate the Main Level sheet so two ordinary one-view pages share floorCamera.
await page.evaluate(() => document.querySelector('#rb-duplicate-page')?.click());
await new Promise((r) => setTimeout(r, 2000));
const sibling = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const doc = rec && rec.reportBuilder;
  const floors = (doc && doc.pages || []).filter((p) => p.type === 'floor' &&
    !(p.meta && p.meta.reserved) &&
    (!p.meta || !Array.isArray(p.meta.views) || p.meta.views.length <= 1 ||
      (p.meta.views.length === 1)));
  // Prefer: count one-view floor pages after duplicate.
  const allFloor = (doc && doc.pages || []).filter((p) => p.type === 'floor' && !(p.meta && p.meta.reserved));
  const oneView = allFloor.filter((p) => {
    const n = Array.isArray(p.meta && p.meta.views) ? p.meta.views.length : 1;
    return n <= 1;
  });
  // Live host camera on the (duplicated) current sheet should match book camera.
  const host = document.querySelector('.rb-stage .rb-sheet [data-rb-topo-live]');
  let liveCam = null;
  // Read from saved floorCamera — sibling pages load via cameraForView → floorCamera.
  return {
    floorCamera: (doc && doc.floorCamera) || null,
    oneViewCount: oneView.length,
    allFloor: allFloor.length,
    hasHost: !!host,
    liveCam,
  };
}, FILE);
check('ordinary duplicate leaves more than one one-view floor figure',
  sibling.oneViewCount >= 2, JSON.stringify(sibling));

// Switch to the other Main Level thumb and confirm it opens on the shared pan.
const otherThumb = await page.evaluate(() => {
  const thumbs = [...document.querySelectorAll('.rb-thumb')];
  const mains = thumbs
    .map((t, i) => ({ i, text: (t.querySelector('.rb-thumb__caption') || {}).textContent || '' }))
    .filter((t) => /Main Level/i.test(t.text));
  if (mains.length < 2) return { ok: false, mains: mains.length };
  // Click the one that is not current.
  const cur = document.querySelector('.rb-thumb.is-active, .rb-thumb[aria-current="true"]');
  const curI = thumbs.indexOf(cur);
  const other = mains.find((m) => m.i !== curI) || mains[0];
  thumbs[other.i].click();
  return { ok: true, other: other.i, curI };
});
check('switched to an ordinary sibling Main Level sheet', otherThumb.ok, JSON.stringify(otherThumb));
await new Promise((r) => setTimeout(r, 3500));

const siblingCam = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const book = rec && rec.reportBuilder && rec.reportBuilder.floorCamera;
  // After reopen of sibling, the live mount should be using book camera.
  // Probe via still-compose extent path is heavy; assert the book camera is
  // what both pages persist, and the active one-view page has no overriding
  // independent view.camera that disagrees.
  const pages = (rec.reportBuilder && rec.reportBuilder.pages) || [];
  const activeId = document.querySelector('.rb-thumb.is-active, .rb-thumb[aria-current="true"]')
    ?.getAttribute('data-page-id');
  const active = pages.find((p) => p.id === activeId) ||
    pages.find((p) => p.type === 'floor' && /main/i.test(p.title || p.railLabel || ''));
  const views = active && active.meta && active.meta.views;
  const viewCam = views && views[0] && views[0].camera;
  return {
    book,
    viewCam,
    // Sibling consumes shared camera: book is the panned one; view either
    // mirrors it or is absent/null so cameraForView falls through to book.
    followsBook: !!book && (Math.abs(book.cx - 0.5) > 0.005 || Math.abs(book.cy - 0.5) > 0.005) &&
      (!viewCam || (
        Math.abs((viewCam.cx || 0) - (book.cx || 0)) < 0.02 &&
        Math.abs((viewCam.cy || 0) - (book.cy || 0)) < 0.02
      )),
  };
}, FILE);
check('untouched ordinary sibling consumes the shared floorCamera',
  siblingCam.followsBook, JSON.stringify(siblingCam));

// Pan further on the sibling so the book advances while the other Main Level
// page can keep a stale view.camera (GPT-029 screen-vs-PDF class).
const host2 = await page.evaluate(() => {
  const el = document.querySelector('.rb-stage .rb-sheet [data-rb-topo-live]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.mouse.move(host2.x, host2.y);
await page.mouse.down();
await page.mouse.move(host2.x - 120, host2.y - 60, { steps: 12 });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 1500));
await page.waitForFunction(
  () => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''),
  { timeout: 20000 }).catch(() => {});

// Leave the editor, plant a deliberately stale view.camera on one ordinary
// sibling while the shared book camera stays at the latest pan, then reopen.
await page.goto(`${BASE}#/`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 600));
const planted = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const doc = rec.reportBuilder;
  const book = doc.floorCamera;
  const floors = (doc.pages || []).filter((p) => p.type === 'floor' && !(p.meta && p.meta.reserved));
  const target = floors.find((p) => Array.isArray(p.meta && p.meta.views) && p.meta.views[0]) || floors[0];
  if (!target) return { ok: false, reason: 'no floor' };
  target.meta = target.meta || {};
  if (!Array.isArray(target.meta.views) || !target.meta.views.length) {
    // Ensure views[] exists for the stale write.
    if (window.ToolboxReportFloorViews) window.ToolboxReportFloorViews.ensurePageViews(target);
  }
  const stale = { cx: 0.4, cy: 0.5, zoom: Number(book && book.zoom) || 1.2, rel: true };
  target.meta.views[0].camera = stale;
  await window.ToolboxDB.saveCustomerFile(rec);
  return {
    ok: true,
    pageId: target.id,
    book: book && { cx: book.cx, cy: book.cy, zoom: book.zoom },
    stale,
    disagree: !!book && Math.abs(book.cx - stale.cx) > 0.05,
  };
}, FILE);
check('planted stale view.camera disagreeing with shared floorCamera',
  planted.ok && planted.disagree, JSON.stringify(planted));

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 3000));
await page.evaluate((pageId) => {
  const thumbs = [...document.querySelectorAll('.rb-thumb')];
  const hit = thumbs.find((t) => t.getAttribute('data-page-id') === pageId) ||
    thumbs.find((t) => /Main Level/i.test((t.querySelector('.rb-thumb__caption') || {}).textContent || ''));
  if (hit) hit.click();
}, planted.pageId);
await page.waitForFunction(
  () => !!document.querySelector('.rb-stage .rb-sheet [data-rb-topo-live]'),
  { timeout: 30000 });
await new Promise((r) => setTimeout(r, 3500));

const reopened = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  return (rec && rec.reportBuilder && rec.reportBuilder.floorCamera) || null;
}, FILE);
check('shared floorCamera survives reopen after ordinary pan',
  !!reopened && (Math.abs(reopened.cx - 0.5) > 0.005 || Math.abs(reopened.cy - 0.5) > 0.005) &&
  !reopened.locked,
  JSON.stringify(reopened));

// Live mount must follow the book, not the stale view.camera (GPT-029).
const liveFollowsBook = await page.evaluate((book) => {
  const host = document.querySelector('.rb-stage .rb-sheet [data-rb-topo-live]');
  // Floor Survey mount does not always expose camera on the DOM; compare via
  // a one-shot still compose using the same path Print uses, after patching
  // compose to record the extent it was given.
  return { hasHost: !!host, bookCx: book && book.cx };
}, reopened);
check('stale-sibling sheet still hosts a live drawing after reopen',
  liveFollowsBook.hasHost, JSON.stringify(liveFollowsBook));

// Capture the extent Print hands to compose — must center on book, not 0.4.
await page.evaluate(() => {
  const api = window.ToolboxFloorSurvey;
  if (!api || typeof api.composeReportTopoFigureForPage !== 'function') return;
  if (api.__extentProbeWrapped) return;
  const orig = api.composeReportTopoFigureForPage.bind(api);
  window.__extentProbes = [];
  api.composeReportTopoFigureForPage = function (rec, opts, getMedia) {
    const ext = opts && opts.extent;
    window.__extentProbes.push({
      canvasId: opts && opts.canvasId,
      extent: ext ? { x: ext.x, y: ext.y, w: ext.w, h: ext.h } : null,
    });
    return orig(rec, opts, getMedia);
  };
  api.__extentProbeWrapped = true;
});

await page.evaluate(() => { window.print = () => { window.__printed = true; }; });
await page.click('#rb-print');
await page.waitForFunction(() => window.__printed === true, { timeout: 90000 });
await new Promise((r) => setTimeout(r, 1200));

const printed = await page.evaluate((book, staleCx) => {
  const img = document.querySelector('.rb-print .rb-topo-still');
  const probes = window.__extentProbes || [];
  const withExt = probes.filter((p) => p && p.extent && p.extent.w > 0);
  const planW = 1200; // fixture plan width
  const expectedBookCenter = (book && book.cx != null) ? book.cx * planW : null;
  const expectedStaleCenter = staleCx * planW;
  const centers = withExt.map((p) => ({
    cx: p.extent.x + p.extent.w / 2,
    cy: p.extent.y + p.extent.h / 2,
  }));
  const near = (a, b, tol) => Math.abs((a || 0) - (b || 0)) <= tol;
  const followsBook = expectedBookCenter != null && centers.some((c) => near(c.cx, expectedBookCenter, planW * 0.04));
  const followsStale = centers.some((c) => near(c.cx, expectedStaleCenter, planW * 0.04));
  return {
    ok: !!(img && img.complete && img.naturalWidth > 40),
    w: img && img.naturalWidth,
    h: img && img.naturalHeight,
    probeCount: withExt.length,
    centers,
    expectedBookCenter,
    expectedStaleCenter,
    followsBook,
    followsStale,
  };
}, reopened, planted.stale.cx);

check('ordinary figure still paints for Print/PDF after shared pan',
  printed.ok, JSON.stringify({ w: printed.w, h: printed.h }));
check('print still extent follows shared floorCamera, not stale view.camera',
  printed.followsBook && !printed.followsStale,
  JSON.stringify(printed));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
