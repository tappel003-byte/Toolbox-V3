/**
 * CF Use Current Location visibility + Floor Survey BP1 GPS capture.
 * Run: node tests/cf-location-and-bp1-gps.mjs
 */
import { createRequire } from 'module';
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
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' — ' + detail : ''));
}

function luminance(rgb) {
  const m = String(rgb).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

// ---- Customer File: Use Current Location visibility ----
await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('toolbox', 2);
    r.onerror = () => rej(r.error);
    r.onsuccess = () => res(r.result);
  });
  await new Promise((res, rej) => {
    const tx = db.transaction(['customerFiles', 'media'], 'readwrite');
    tx.objectStore('customerFiles').clear();
    tx.objectStore('media').clear();
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  let rec = window.ToolboxApp.blankCustomerFile('cf-loc-1');
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  await window.ToolboxDB.saveCustomerFile(rec);
});
await page.goto(BASE + '#/file/cf-loc-1/edit', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 800));

const loc = await page.evaluate(() => {
  const btn = document.getElementById('use-current-location');
  if (!btn) return null;
  const cs = getComputedStyle(btn);
  const r = btn.getBoundingClientRect();
  const bodyBg = getComputedStyle(document.body).backgroundColor;
  return {
    text: (btn.textContent || '').trim(),
    color: cs.color,
    bodyBg,
    fontSize: cs.fontSize,
    underline: cs.textDecorationLine,
    w: Math.round(r.width),
    h: Math.round(r.height),
    visible: r.width > 40 && r.height > 16 && cs.visibility !== 'hidden' && cs.opacity !== '0',
    wired: typeof btn.onclick === 'function' || btn.getAttribute('id') === 'use-current-location',
  };
});
check('Use Current Location control present', !!loc && /Use Current Location/i.test(loc?.text || ''), JSON.stringify(loc));
const lum = loc ? luminance(loc.color) : null;
const bgLum = loc ? luminance(loc.bodyBg) : null;
check(
  'Use Current Location is visually distinct (not washed-out)',
  lum != null && bgLum != null && Math.abs(lum - bgLum) > 0.25,
  JSON.stringify({ lum, bgLum, color: loc?.color }),
);
check('Use Current Location has underline affordance', /underline/i.test(loc?.underline || ''), loc?.underline);
check('Phone viewport — location control in layout', loc?.visible && loc?.w > 80, JSON.stringify(loc));
await page.screenshot({ path: `${OUT}/cf_use_current_location_visible.png` });

// Behavior still wired: click triggers feedback (mock geolocation denial is fine)
await page.evaluate(() => {
  navigator.geolocation.getCurrentPosition = (ok, err) => {
    err({ code: 1, message: 'denied' });
  };
});
await page.click('#use-current-location');
await new Promise((r) => setTimeout(r, 400));
const feedback = await page.evaluate(() => document.getElementById('address-feedback')?.textContent || '');
check('Use Current Location still invokes geolocation path', /location|Couldn.?t|manually/i.test(feedback), feedback);

// ---- Floor Survey: Capture GPS on Set Base Point ----
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.goto(BASE, { waitUntil: 'networkidle0' });
const seeded = await page.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 400;
  c.height = 300;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 400, 300);
  ctx.strokeStyle = '#333';
  ctx.strokeRect(20, 20, 360, 260);
  const plan = c.toDataURL('image/png');
  await window.ToolboxDB.putMedia('plan-bp1', plan);
  let rec = window.ToolboxApp.blankCustomerFile('fs-bp1-gps');
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'BP';
  rec.lastName = 'GPS';
  rec.propertyAddress = '50 Base St';
  const now = new Date().toISOString();
  const canvasId = 'canvas-bp1';
  rec.planSetup.canvases = [
    {
      id: canvasId,
      name: 'Main',
      createdAt: now,
      updatedAt: now,
      plan: { id: 'plan-bp1', width: 400, height: 300 },
      rooms: [],
      frontDoorFacing: 'S',
      frontDoor: null,
    },
  ];
  rec.planSetup.activeCanvasId = canvasId;
  window.ToolboxPlanSetup.ensureFloorSurvey(rec);
  window.ToolboxPlanSetup.ensureFloorSurveyCanvasRef(rec, canvasId);
  // Minimal closed boundary so field mode can place points
  rec.floorSurvey.byCanvasId[canvasId].boundary = [
    { x: 40, y: 40 },
    { x: 360, y: 40 },
    { x: 360, y: 260 },
    { x: 40, y: 260 },
  ];
  await window.ToolboxDB.saveCustomerFile(rec);
  return { id: rec.id, canvasId };
});

await page.goto(BASE + `#/file/${seeded.id}/floor`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 2500));

// Skip setup wizard if present — go to field
await page.evaluate(() => {
  const data = [...document.querySelectorAll('button')].find((b) => /^\s*Data\s*$/i.test(b.textContent || ''));
  data?.click();
});
await new Promise((r) => setTimeout(r, 800));

async function tapPlan(nx, ny) {
  const box = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  if (!box) return false;
  await page.mouse.click(box.x + box.w * nx, box.y + box.h * ny);
  return true;
}

await tapPlan(0.5, 0.5);
await new Promise((r) => setTimeout(r, 600));

const modal1 = await page.evaluate(() => {
  const t = document.body.innerText || '';
  const buttons = [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim());
  return {
    hasSetBase: /Set Base Point/i.test(t),
    hasCapture: buttons.some((b) => /Capture GPS/i.test(b)),
    buttons: buttons.filter((b) => /Capture|Continue|Cancel|GPS/i.test(b)),
  };
});
check('First point opens Set Base Point', modal1.hasSetBase, JSON.stringify(modal1));
check('Capture GPS present on Set Base Point', modal1.hasCapture, JSON.stringify(modal1.buttons));
await page.screenshot({ path: `${OUT}/fs_bp1_capture_gps_modal.png` });

// Success path with mocked geolocation
await page.evaluate(() => {
  navigator.geolocation.getCurrentPosition = (ok) => {
    ok({
      coords: {
        latitude: 40.7128,
        longitude: -74.006,
        accuracy: 4.5,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
      timestamp: Date.now(),
    });
  };
});
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => /Capture GPS/i.test(b.textContent || ''))?.click();
});
await new Promise((r) => setTimeout(r, 900));

const afterOk = await page.evaluate(async (id, canvasId) => {
  const t = document.body.innerText || '';
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const gps = rec.floorSurvey?.byCanvasId?.[canvasId]?.bp1Gps;
  return {
    statusText: /Location captured/i.test(t),
    accuracyShown: /±\s*\d+\s*ft/i.test(t),
    gps,
  };
}, seeded.id, seeded.canvasId);
check(
  'Successful capture stores lat/lon/accuracy/timestamp',
  afterOk.gps &&
    typeof afterOk.gps.latitude === 'number' &&
    typeof afterOk.gps.longitude === 'number' &&
    typeof afterOk.gps.accuracyMeters === 'number' &&
    typeof afterOk.gps.capturedAt === 'number' &&
    Math.abs(afterOk.gps.latitude - 40.7128) < 0.0001,
  JSON.stringify(afterOk),
);
check('Successful capture shows compact status', afterOk.statusText && afterOk.accuracyShown, JSON.stringify(afterOk));
await page.screenshot({ path: `${OUT}/fs_bp1_gps_captured.png` });

// Continue after success → keypad → confirm BP
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Continue')?.click();
});
await new Promise((r) => setTimeout(r, 500));
await page.evaluate(() => {
  const withCheck = [...document.querySelectorAll('button')].find(
    (b) => b.innerHTML.includes('lucide-check') || b.querySelector('svg.lucide-check'),
  );
  withCheck?.click();
});
await new Promise((r) => setTimeout(r, 900));

const afterContinue = await page.evaluate(async (id, canvasId) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const layer = rec.floorSurvey.byCanvasId[canvasId];
  const p0 = layer?.points?.[0];
  return {
    gps: layer?.bp1Gps,
    point: p0 ? { isBasePoint: !!p0.isBasePoint, label: p0.label, value: p0.value } : null,
  };
}, seeded.id, seeded.canvasId);
check(
  'Continue after GPS still creates BP1 (value path intact)',
  afterContinue.point?.isBasePoint && afterContinue.point?.label === 'BP1',
  JSON.stringify(afterContinue),
);
check('BP1 GPS still present after Continue', !!afterContinue.gps, JSON.stringify(afterContinue.gps));

// Reopen Floor Survey — GPS persists
await page.goto(BASE + `#/file/${seeded.id}`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 600));
await page.goto(BASE + `#/file/${seeded.id}/floor`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 2000));
const reopened = await page.evaluate(async (id, canvasId) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  return rec.floorSurvey?.byCanvasId?.[canvasId]?.bp1Gps || null;
}, seeded.id, seeded.canvasId);
check(
  'BP1 GPS survives reopen',
  reopened && Math.abs(reopened.latitude - 40.7128) < 0.0001 && reopened.accuracyMeters === 4.5,
  JSON.stringify(reopened),
);

// Failure path on a fresh CF
await page.goto(BASE, { waitUntil: 'networkidle0' });
const failSeed = await page.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 400;
  c.height = 300;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 400, 300);
  const plan = c.toDataURL('image/png');
  await window.ToolboxDB.putMedia('plan-bp1-fail', plan);
  let rec = window.ToolboxApp.blankCustomerFile('fs-bp1-fail');
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.propertyAddress = '51 Fail St';
  const now = new Date().toISOString();
  const canvasId = 'canvas-fail';
  rec.planSetup.canvases = [
    {
      id: canvasId,
      name: 'Main',
      createdAt: now,
      updatedAt: now,
      plan: { id: 'plan-bp1-fail', width: 400, height: 300 },
      rooms: [],
      frontDoorFacing: 'S',
      frontDoor: null,
    },
  ];
  rec.planSetup.activeCanvasId = canvasId;
  window.ToolboxPlanSetup.ensureFloorSurvey(rec);
  window.ToolboxPlanSetup.ensureFloorSurveyCanvasRef(rec, canvasId);
  rec.floorSurvey.byCanvasId[canvasId].boundary = [
    { x: 40, y: 40 },
    { x: 360, y: 40 },
    { x: 360, y: 260 },
    { x: 40, y: 260 },
  ];
  await window.ToolboxDB.saveCustomerFile(rec);
  return { id: rec.id, canvasId };
});

await page.goto(BASE + `#/file/${failSeed.id}/floor`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 2500));
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => /^\s*Data\s*$/i.test(b.textContent || ''))?.click();
});
await new Promise((r) => setTimeout(r, 800));
await tapPlan(0.5, 0.5);
await new Promise((r) => setTimeout(r, 600));

await page.evaluate(() => {
  navigator.geolocation.getCurrentPosition = (_ok, err) => {
    err({ code: 2, message: 'unavailable' });
  };
});
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => /Capture GPS/i.test(b.textContent || ''))?.click();
});
await new Promise((r) => setTimeout(r, 700));

const failUi = await page.evaluate(() => {
  const t = document.body.innerText || '';
  const buttons = [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim());
  return {
    hasContinueWithout: buttons.some((b) => /Continue Without GPS/i.test(b)),
    stillHasModal: /Set Base Point/i.test(t),
    failHint: /Couldn.?t get GPS|continue without/i.test(t),
  };
});
check('Failed GPS exposes Continue Without GPS', failUi.hasContinueWithout, JSON.stringify(failUi));
check('Failed GPS does not trap (modal still usable)', failUi.stillHasModal && failUi.failHint, JSON.stringify(failUi));
await page.screenshot({ path: `${OUT}/fs_bp1_gps_failed.png` });

await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => /Continue Without GPS/i.test(b.textContent || ''))?.click();
});
await new Promise((r) => setTimeout(r, 500));
await page.evaluate(() => {
  const withCheck = [...document.querySelectorAll('button')].find(
    (b) => b.innerHTML.includes('lucide-check') || b.querySelector('svg.lucide-check'),
  );
  withCheck?.click();
});
await new Promise((r) => setTimeout(r, 900));

const failDone = await page.evaluate(async (id, canvasId) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const layer = rec.floorSurvey.byCanvasId[canvasId];
  return {
    points: layer?.points?.length || 0,
    bp1: layer?.points?.[0]?.isBasePoint,
    gps: layer?.bp1Gps || null,
  };
}, failSeed.id, failSeed.canvasId);
check(
  'Continue Without GPS still creates BP1 and stores no GPS',
  failDone.points >= 1 && failDone.bp1 && !failDone.gps,
  JSON.stringify(failDone),
);

const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
await browser.close();
if (failed.length) process.exit(1);
