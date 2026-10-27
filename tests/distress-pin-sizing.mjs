/**
 * Distress numbered pin size — capture vs report ownership workflows.
 *
 * Capture: Pin size −/+ per Customer File on this device (ds-capture-sizes).
 * Report: Pin size slider → reportBuilder.penLog.pinScale only.
 *
 * Run: static server on 8765, then node tests/distress-pin-sizing.mjs
 */
import { createRequire } from 'module';
import { mkdir } from 'fs/promises';
import fs from 'fs';

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

function near(a, b, tol) {
  return Math.abs(Number(a) - Number(b)) <= tol;
}

await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

function distressFrame() {
  return page.frames().find((fr) => /distress-survey\/survey\.html/.test(fr.url()));
}

async function clearState() {
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    const db = await new Promise((res, rej) => {
      const req = indexedDB.open('toolbox', 2);
      req.onerror = () => rej(req.error);
      req.onsuccess = () => res(req.result);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction(['customerFiles', 'media'], 'readwrite');
      tx.objectStore('customerFiles').clear();
      tx.objectStore('media').clear();
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    localStorage.clear();
  });
  await page.goto(BASE, { waitUntil: 'networkidle0' });
}

async function seedFiles() {
  return page.evaluate(async () => {
    function planPng(w, h, label) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 4;
      ctx.strokeRect(16, 16, w - 32, h - 32);
      ctx.fillStyle = '#555';
      ctx.font = '28px sans-serif';
      ctx.fillText(label, 40, 60);
      return c.toDataURL('image/png');
    }
    function photo(label) {
      const c = document.createElement('canvas');
      c.width = 240;
      c.height = 160;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#8aa2b5';
      ctx.fillRect(0, 0, 240, 160);
      ctx.fillStyle = '#fff';
      ctx.font = '22px sans-serif';
      ctx.fillText(label, 16, 88);
      return c.toDataURL('image/jpeg', 0.85);
    }

    await window.ToolboxDB.putMedia('plan-pin-a', planPng(800, 600, 'Alpha'));
    await window.ToolboxDB.putMedia('plan-pin-b', planPng(800, 600, 'Beta'));
    await window.ToolboxDB.putMedia('ph_pin_a1', photo('A1'));
    await window.ToolboxDB.putMedia('ph_pin_a2', photo('A2'));
    await window.ToolboxDB.putMedia('ph_pin_b1', photo('B1'));

    async function seed(id, name, pins) {
      const rec = window.ToolboxApp.blankCustomerFile(id);
      window.ToolboxPlanSetup.ensurePlanSetup(rec);
      rec.firstName = name;
      rec.lastName = 'Pins';
      rec.propertyAddress = '9 Pin Size Way';
      const canvasId = 'canvas-' + id;
      const now = new Date().toISOString();
      rec.planSetup.canvases = [{
        id: canvasId,
        name: 'Main Level',
        createdAt: now,
        updatedAt: now,
        plan: { id: 'plan-pin-' + (id === 'pin-a' ? 'a' : 'b'), width: 800, height: 600 },
        rooms: [{ name: 'Hall', x: 120, y: 140 }],
        frontDoorFacing: 'S',
        frontDoor: null,
      }];
      rec.planSetup.activeCanvasId = canvasId;
      window.ToolboxPlanSetup.ensurePlanSetup(rec);
      rec.distress.activeCanvasId = canvasId;
      rec.distress.pins = pins.map((p) => ({ ...p, canvasId }));
      await window.ToolboxDB.saveCustomerFile(rec);
      return { id, canvasId };
    }

    const a = await seed('pin-a', 'Alpha', [
      { id: 'pa1', x: 200, y: 220, photos: ['ph_pin_a1'], description: 'Crack A', location: 'Hall' },
      { id: 'pa2', x: 520, y: 300, photos: ['ph_pin_a2'], description: 'Stain A', location: 'Living' },
    ]);
    const b = await seed('pin-b', 'Beta', [
      { id: 'pb1', x: 300, y: 250, photos: ['ph_pin_b1'], description: 'Crack B', location: 'Hall' },
    ]);
    return { a, b };
  });
}

async function openDistress(fileId) {
  await page.goto(BASE + `#/file/${fileId}/distress`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => {
    return [...document.querySelectorAll('iframe')].some((el) =>
      /distress-survey\/survey\.html/.test(el.src || ''));
  }, { timeout: 20000 });
  const fr = distressFrame();
  if (!fr) throw new Error('no distress iframe for ' + fileId);
  await fr.waitForSelector('#screenWork.active, body.host-mode #stage', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 900));
  // Ensure pin-size pill is wired (enterWork calls setupPinSizePill).
  await fr.waitForSelector('#pinSizePill', { timeout: 10000 });
  return fr;
}

async function capturePinState(fr) {
  return fr.evaluate(() => {
    const scale = typeof _capturePinScale === 'number' ? _capturePinScale : null;
    const stored = localStorage.getItem(
      (typeof TOOLBOX_CF_ID === 'string' && TOOLBOX_CF_ID)
        ? ('ds-capture-sizes:' + TOOLBOX_CF_ID)
        : 'ds-capture-sizes:local',
    );
    let visual = null;
    try { visual = typeof pinVisualRadius === 'function' ? pinVisualRadius() : null; } catch (_) {}
    const pinEls = [...document.querySelectorAll('.pin, [data-pin-id], .pin-label, .map-pin')];
    // Prefer the SVG/canvas pin circles when present.
    const circles = [...document.querySelectorAll('#pinsLayer circle, #overlaySvg circle, svg circle')];
    const radii = circles.map((c) => Number(c.getAttribute('r'))).filter((n) => n > 0);
    const pill = document.getElementById('pinSizePill');
    const minus = document.getElementById('pinSizeMinus');
    const plus = document.getElementById('pinSizePlus');
    return {
      scale,
      stored,
      visual,
      radii,
      maxR: radii.length ? Math.max(...radii) : null,
      pillVisible: !!(pill && pill.offsetParent !== null),
      label: pill ? (pill.querySelector('.ps-label')?.textContent || '').trim() : '',
      minusDisabled: !!(minus && minus.disabled),
      plusDisabled: !!(plus && plus.disabled),
      pinDomCount: pinEls.length,
      cfId: typeof TOOLBOX_CF_ID === 'string' ? TOOLBOX_CF_ID : null,
    };
  });
}

async function bumpCapturePlus(fr, times = 4) {
  return fr.evaluate((n) => {
    const plus = document.getElementById('pinSizePlus');
    if (!plus) return { ok: false, reason: 'no plus' };
    for (let i = 0; i < n; i++) plus.click();
    return {
      ok: true,
      scale: _capturePinScale,
      visual: pinVisualRadius(),
      stored: localStorage.getItem('ds-capture-sizes:' + TOOLBOX_CF_ID),
    };
  }, times);
}

async function openPenLog(fileId) {
  await page.goto(BASE + `#/file/${fileId}/report`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(
    () => !!document.querySelector('.rb-shell[data-report-ready="true"]'),
    { timeout: 40000 },
  );
  await page.waitForFunction(
    () => !!document.querySelector('.rb-thumb[data-page-id^="distress-"]'),
    { timeout: 20000 },
  );
  await page.evaluate(() => {
    document.querySelector('.rb-thumb[data-page-id^="distress-"]')?.click();
  });
  await page.waitForFunction(() => {
    const title = document.querySelector('.rb-sheet .rb-rail__title');
    const fit = document.querySelector('.rb-sheet .rb-penlog__fit');
    const slider = document.querySelector('#rb-penlog-pin-size');
    return title && /Picture\/Damage Locations/.test(title.textContent || '') &&
      fit && fit.getBoundingClientRect().width > 40 &&
      slider && !slider.closest('[hidden]');
  }, { timeout: 25000 });
  await new Promise((r) => setTimeout(r, 600));
}

async function reportPinState() {
  return page.evaluate(async (id) => {
    const rec = await window.ToolboxDB.getCustomerFile(id);
    const fit = document.querySelector('.rb-sheet .rb-penlog__fit');
    const root = document.querySelector('.rb-sheet .rb-penlog');
    const pin = document.querySelector('.rb-sheet .rb-penlog__pin');
    const slider = document.querySelector('#rb-penlog-pin-size');
    const val = document.querySelector('#rb-penlog-pin-size-val');
    return {
      pinScale: rec?.reportBuilder?.penLog?.pinScale ?? null,
      notes: rec?.reportBuilder?.penLog?.notes || null,
      attr: root ? root.getAttribute('data-rb-pin-scale') : null,
      cssPin: fit ? (fit.style.getPropertyValue('--rb-pin-size') || '').trim() : '',
      pinW: pin ? pin.getBoundingClientRect().width : null,
      slider: slider ? Number(slider.value) : null,
      sliderLabel: val ? val.textContent.trim() : '',
      captureKey: localStorage.getItem('ds-capture-sizes:' + id),
      panelHidden: !!(document.querySelector('#rb-penlog-panel')?.hidden),
    };
  }, fileIdForReportState);
}

// Bound after seed; openPenLog helpers close over file id via this.
let fileIdForReportState = 'pin-a';

// --- Math helpers (no DOM) ---
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await clearState();

const math = await page.evaluate(() => {
  const api = window.ToolboxPenLog;
  const out = [];
  function assert(name, cond, detail) {
    out.push({ name, ok: !!cond, detail: detail || '' });
  }
  assert('clampPinScale default is 1', api.clampPinScale(null) === 1 && api.clampPinScale(0) === 1);
  assert('clampPinScale clamps low', api.clampPinScale(0.1) === 0.35);
  assert('clampPinScale clamps high', api.clampPinScale(9) === 2.5);
  assert('clampPinScale keeps mid', api.clampPinScale(1.45) === 1.45);
  return out;
});
math.forEach((item) => check(item.name, item.ok, item.detail));

const seeded = await seedFiles();
fileIdForReportState = seeded.a.id;

// Poison device prefs that must never drive the report.
await page.evaluate((aId) => {
  localStorage.setItem('ds-capture-sizes:' + aId, JSON.stringify({ pinScale: 2.4 }));
  localStorage.setItem('ds-capture-sizes:pin-b', JSON.stringify({ pinScale: 0.4 }));
  localStorage.setItem('dpp-size:' + aId, '8');
}, seeded.a.id);

// ========== 1) Phone capture: −/+ resizes pins ==========
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
let fr = await openDistress(seeded.a.id);
const beforeBump = await capturePinState(fr);
check(
  '1) Pin size pill visible with label on phone capture',
  beforeBump.pillVisible && beforeBump.label === 'Pin size',
  JSON.stringify(beforeBump),
);
// Poison in localStorage should load as starting scale for THIS file.
check(
  '1b) Capture loads per-file ds-capture-sizes (poisoned 2.4)',
  near(beforeBump.scale, 2.4, 0.02),
  JSON.stringify(beforeBump),
);

// Drop to a mid value via minus, then grow with plus so size change is visible.
await fr.evaluate(() => {
  // Reset to 1.0 via save helper, then bump up for a clear delta.
  saveCapturePinScale(1.0);
  renderPins();
});
const atOne = await capturePinState(fr);
const bumped = await bumpCapturePlus(fr, 5); // → 1.5
await new Promise((r) => setTimeout(r, 300));
const afterBump = await capturePinState(fr);
check(
  '1c) Capture + enlarges visual pin radius',
  bumped.ok && afterBump.visual > atOne.visual * 1.2 && near(afterBump.scale, 1.5, 0.02),
  JSON.stringify({ atOne, bumped, afterBump }),
);
check(
  '1d) Capture wrote ds-capture-sizes for this CF only',
  (() => {
    try {
      const parsed = JSON.parse(afterBump.stored || '{}');
      return near(parsed.pinScale, 1.5, 0.02) && afterBump.cfId === seeded.a.id;
    } catch {
      return false;
    }
  })(),
  JSON.stringify(afterBump),
);

await page.screenshot({ path: `${OUT}/distress-pin-capture-phone.png` });

// Tap still works (hit target independent of visual shrink/grow).
const tapOk = await fr.evaluate(() => {
  const pins = (project && project.pins) || [];
  if (!pins.length) return { ok: false, reason: 'no pins' };
  const p = pins[0];
  // Simulate selecting via hitTest if available, else count stays.
  let hit = null;
  try {
    if (typeof hitTestPin === 'function') hit = hitTestPin(p.x, p.y);
    else if (typeof findPinAt === 'function') hit = findPinAt(p.x, p.y);
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
  // Fallback: pin count + numbering intact.
  return {
    ok: pins.length >= 2 && pins.every((x) => x.num || x.id),
    count: pins.length,
    hit: hit && (hit.id || hit),
    nums: pins.map((x) => x.num),
  };
});
check('1e) Pins still present after size change (numbering intact)', tapOk.ok, JSON.stringify(tapOk));

// ========== 2) Close/reopen retains; other CF unchanged ==========
await page.goto(BASE + `#/file/${seeded.a.id}`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 400));
fr = await openDistress(seeded.a.id);
const reopened = await capturePinState(fr);
check(
  '2) Capture pin scale retained after close/reopen',
  near(reopened.scale, 1.5, 0.02),
  JSON.stringify(reopened),
);

fr = await openDistress(seeded.b.id);
const otherCapture = await capturePinState(fr);
check(
  '2b) Other Customer File keeps its own capture pin scale',
  near(otherCapture.scale, 0.4, 0.02) && otherCapture.cfId === seeded.b.id,
  JSON.stringify(otherCapture),
);

// ========== 3) Resize after adjust does not reset ==========
await page.setViewport({ width: 1024, height: 768, deviceScaleFactor: 1 });
await new Promise((r) => setTimeout(r, 500));
fr = await openDistress(seeded.a.id);
const afterResize = await capturePinState(fr);
check(
  '3) Viewport resize does not rewrite capture pin scale',
  near(afterResize.scale, 1.5, 0.02),
  JSON.stringify(afterResize),
);
// Also: screen-class default must NOT be reapplied over stored value.
const defaultWouldBe = await fr.evaluate(() => screenDistressPinScaleDefault());
check(
  '3b) Stored scale differs from live screen-class default (proves no live Auto)',
  !near(afterResize.scale, defaultWouldBe, 0.05),
  JSON.stringify({ stored: afterResize.scale, screenClass: defaultWouldBe }),
);

// ========== 4) Capture change → report pin size unchanged ==========
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
// Ensure report starts without pinScale so we can see the seed, then verify
// capture poison does not become the report value.
await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  if (rec.reportBuilder && rec.reportBuilder.penLog) {
    delete rec.reportBuilder.penLog.pinScale;
  }
  // Leave notes alone if any.
  await window.ToolboxDB.saveCustomerFile(rec);
  // Capture is still 1.5 — if report wrongly read it, slider would be 1.5.
}, seeded.a.id);

fileIdForReportState = seeded.a.id;
await openPenLog(seeded.a.id);
let reportAfterCapture = await reportPinState();
check(
  '4) Report seeds pinScale=1 and ignores capture ds-capture-sizes=1.5',
  near(reportAfterCapture.pinScale, 1, 0.02) &&
    near(reportAfterCapture.slider, 1, 0.02) &&
    near(Number(reportAfterCapture.attr), 1, 0.02) &&
    near(JSON.parse(reportAfterCapture.captureKey || '{}').pinScale, 1.5, 0.02),
  JSON.stringify(reportAfterCapture),
);
check(
  '4b) Pen Log Pin size slider is visible on the rail',
  reportAfterCapture.sliderLabel === '1.00×' && !reportAfterCapture.panelHidden,
  JSON.stringify(reportAfterCapture),
);

await page.screenshot({ path: `${OUT}/distress-pin-report-default.png` });

// Spy: report paths must not read ds-capture-sizes.
const spyReads = await page.evaluate(async (id) => {
  const reads = [];
  const orig = Storage.prototype.getItem;
  Storage.prototype.getItem = function (key) {
    const k = String(key);
    if (k.indexOf('ds-capture-sizes') === 0) reads.push(k);
    return orig.call(this, key);
  };
  // Force a re-render of the active pen-log page.
  const thumb = document.querySelector('.rb-thumb[data-page-id^="distress-"]');
  if (thumb) thumb.click();
  await new Promise((r) => setTimeout(r, 800));
  // Present compose path if available.
  let presentPin = null;
  try {
    const present = document.querySelector('#rb-present');
    if (present) {
      present.click();
      await new Promise((r) => setTimeout(r, 1500));
      const fit = document.querySelector('.rb-print--present .rb-penlog__fit');
      presentPin = fit ? (fit.style.getPropertyValue('--rb-pin-size') || '').trim() : null;
      document.querySelector('#rb-present-close, [data-rb-present-close], .rb-present__close')?.click();
      // Escape present if still open.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
    }
  } catch (_) { /* present optional */ }
  Storage.prototype.getItem = orig;
  return { reads, presentPin };
}, seeded.a.id);
check(
  '4c) Report render/present does not read ds-capture-sizes',
  spyReads.reads.length === 0,
  JSON.stringify(spyReads),
);

// ========== 5) Report slider updates sheet; capture + other CF untouched ==========
const pinWBefore = reportAfterCapture.pinW;
await page.evaluate(() => {
  const slider = document.querySelector('#rb-penlog-pin-size');
  slider.value = '1.8';
  slider.dispatchEvent(new Event('input', { bubbles: true }));
  slider.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForFunction(() => {
  const root = document.querySelector('.rb-sheet .rb-penlog');
  return root && root.getAttribute('data-rb-pin-scale') === '1.8';
}, { timeout: 10000 });
await new Promise((r) => setTimeout(r, 1200)); // autosave
const reportAfterSlider = await reportPinState();
check(
  '5) Report slider writes penLog.pinScale and updates sheet attr',
  near(reportAfterSlider.pinScale, 1.8, 0.02) &&
    near(Number(reportAfterSlider.attr), 1.8, 0.02) &&
    reportAfterSlider.sliderLabel === '1.80×' &&
    !!reportAfterSlider.cssPin,
  JSON.stringify(reportAfterSlider),
);
check(
  '5b) Sheet pin diameter grew with slider',
  reportAfterSlider.pinW != null && pinWBefore != null &&
    reportAfterSlider.pinW > pinWBefore * 1.3,
  JSON.stringify({ pinWBefore, pinWAfter: reportAfterSlider.pinW }),
);

const captureStill = await page.evaluate((aId, bId) => ({
  a: localStorage.getItem('ds-capture-sizes:' + aId),
  b: localStorage.getItem('ds-capture-sizes:' + bId),
}), seeded.a.id, seeded.b.id);
check(
  '5c) Report slider did not rewrite capture prefs',
  near(JSON.parse(captureStill.a || '{}').pinScale, 1.5, 0.02) &&
    near(JSON.parse(captureStill.b || '{}').pinScale, 0.4, 0.02),
  JSON.stringify(captureStill),
);

fileIdForReportState = seeded.b.id;
await openPenLog(seeded.b.id);
const otherReport = await reportPinState();
check(
  '5d) Other Customer File report keeps its own pinScale (seeded 1)',
  near(otherReport.pinScale, 1, 0.02) && near(otherReport.slider, 1, 0.02),
  JSON.stringify(otherReport),
);

// ========== 6) Reopen report retains; missing field seeds only itself ==========
fileIdForReportState = seeded.a.id;
await page.goto(BASE + `#/file/${seeded.a.id}`, { waitUntil: 'networkidle0' });
await openPenLog(seeded.a.id);
const reopenedReport = await reportPinState();
check(
  '6) Report pinScale retained after reopen',
  near(reopenedReport.pinScale, 1.8, 0.02) &&
    near(Number(reopenedReport.attr), 1.8, 0.02),
  JSON.stringify(reopenedReport),
);

// Missing field: leave the report so unmount cannot rewrite, strip pinScale,
// reopen — must seed to 1 without reading capture.
await page.goto(BASE + `#/file/${seeded.a.id}`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 800));
await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  if (!rec.reportBuilder) rec.reportBuilder = { version: 1, pages: [] };
  rec.reportBuilder.penLog = rec.reportBuilder.penLog || {
    schema: 'toolbox.pen-log-notes',
    schemaVersion: 1,
  };
  delete rec.reportBuilder.penLog.pinScale;
  localStorage.setItem('ds-capture-sizes:' + id, JSON.stringify({ pinScale: 2.2 }));
  await window.ToolboxDB.saveCustomerFile(rec);
}, seeded.a.id);
await openPenLog(seeded.a.id);
await page.waitForFunction(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const scale = rec && rec.reportBuilder && rec.reportBuilder.penLog &&
    Number(rec.reportBuilder.penLog.pinScale);
  const root = document.querySelector('.rb-sheet .rb-penlog');
  const attr = root && root.getAttribute('data-rb-pin-scale');
  return isFinite(scale) && scale > 0 && attr === '1';
}, { timeout: 15000 }, seeded.a.id).catch(() => null);
const seededMissing = await reportPinState();
check(
  '6b) Missing penLog.pinScale seeds itself to 1 (not capture 2.2)',
  near(seededMissing.pinScale, 1, 0.02) &&
    near(Number(seededMissing.attr), 1, 0.02) &&
    near(JSON.parse(seededMissing.captureKey || '{}').pinScale, 2.2, 0.02),
  JSON.stringify(seededMissing),
);

await page.screenshot({ path: `${OUT}/distress-pin-report-slider.png` });

// Capture still independent after report seed.
fr = await openDistress(seeded.a.id);
const captureAfterReport = await capturePinState(fr);
check(
  '6c) Capture still holds its own scale after report seed',
  near(captureAfterReport.scale, 2.2, 0.02),
  JSON.stringify(captureAfterReport),
);

fs.writeFileSync(`${OUT}/distress-pin-sizing-results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `FAILED ${failed.length}/${results.length}` : `ALL PASSED ${results.length}`);
await browser.close();
process.exit(failed.length ? 1 : 0);
