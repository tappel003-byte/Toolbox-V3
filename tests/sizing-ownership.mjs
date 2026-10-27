/**
 * Sizing ownership: capture per Customer File on this device; report in CF only.
 *
 * Acceptance:
 * 1. Change capture sizes → report stays unchanged
 * 2. Change report sizes → capture and another Customer File stay unchanged
 * 3. Reopen → each retains its settings
 *
 * Run: static server on 8765, then node tests/sizing-ownership.mjs
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

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

async function blankPlan() {
  return page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 300;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 400, 300);
    ctx.strokeStyle = '#333';
    ctx.strokeRect(20, 20, 360, 260);
    return c.toDataURL('image/png');
  });
}

async function seedFile(id, name) {
  const dataUrl = await blankPlan();
  return page.evaluate(async ({ id, name, dataUrl }) => {
    const planId = 'plan-' + id;
    const canvasId = 'canvas-' + id;
    await window.ToolboxDB.putMedia(planId, dataUrl);
    let rec = window.ToolboxApp.blankCustomerFile(id);
    window.ToolboxPlanSetup.ensurePlanSetup(rec);
    rec.firstName = name;
    rec.lastName = 'Owner';
    rec.propertyAddress = '1 Size St';
    rec.planSetup.canvases = [{
      id: canvasId,
      name: 'Main Level',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      plan: { id: planId, width: 400, height: 300 },
      rooms: [],
      frontDoorFacing: 'S',
      frontDoor: null,
    }];
    rec.planSetup.activeCanvasId = canvasId;
    window.ToolboxPlanSetup.ensurePlanSetup(rec);
    window.ToolboxPlanSetup.ensureFloorSurveyCanvasRef(rec, canvasId);
    const poly = [
      { x: 40, y: 40 }, { x: 360, y: 40 }, { x: 360, y: 260 }, { x: 40, y: 260 },
    ];
    const now = Date.now();
    const points = [
      { id: 'p1', index: 1, x: 120, y: 120, value: 9.4, createdAt: now, updatedAt: now },
      { id: 'p2', index: 2, x: 280, y: 120, value: 8.1, createdAt: now, updatedAt: now },
      { id: 'p3', index: 3, x: 200, y: 200, value: 7.1, createdAt: now, updatedAt: now },
    ];
    if (!rec.floorSurvey) rec.floorSurvey = { byCanvasId: {} };
    rec.floorSurvey.byCanvasId[canvasId] = {
      canvasId,
      points,
      areas: [{ id: 'a1', name: 'Main Level', polygon: poly, createdAt: 1 }],
      boundary: poly,
    };
    // Seed a report with a known pill lock (sheet default-ish, not 48).
    const chrome = (window.ToolboxReportFloorLayout &&
      Number(window.ToolboxReportFloorLayout.CHROME_SCALE)) || (1632 / 1220);
    rec.reportBuilder = {
      version: 1,
      pages: [{
        id: 'floor-' + canvasId,
        type: 'floor',
        title: 'Floor Level Survey — Main Level',
        meta: {
          canvasId,
          areaId: 'a1',
          floorView: {
            showLegend: true,
            showHighLow: true,
            showStatsPill: true,
            legendScale: 1.2,
            pointLabelFontSize: 11,
            highLowPinSize: 11,
          },
        },
      }],
      activePageId: 'floor-' + canvasId,
      floorLayout: window.ToolboxReportFloorLayout
        ? window.ToolboxReportFloorLayout.normalizeLayout({
          legendLock: { locked: true, scale: 1.2 },
          pillLock: { locked: true, scale: chrome }, // ≡ 32px
        })
        : { legendLock: { locked: true, scale: 1.2 }, pillLock: { locked: true, scale: chrome } },
    };
    await window.ToolboxDB.saveCustomerFile(rec);
    return { id, canvasId, chrome, pillScale: chrome };
  }, { id, name, dataUrl });
}

await page.setViewport({ width: 1024, height: 768, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.evaluate(async () => {
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
});

const a = await seedFile('size-a', 'Alpha');
const b = await seedFile('size-b', 'Beta');

// Poison the old device-global key — report must ignore it.
await page.evaluate(() => {
  localStorage.setItem('stats-chip-size', '96');
  localStorage.setItem('topo.legend.v1', JSON.stringify({ scale: 3.5, x: 1, y: 1 }));
});

const beforeReport = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  return {
    pill: rec.reportBuilder?.floorLayout?.pillLock?.scale,
    legend: rec.reportBuilder?.floorLayout?.legendLock?.scale,
  };
}, a.id);
check(
  'Seeded report has sheet pill/legend locks (not empty)',
  Number(beforeReport.pill) > 0 && Number(beforeReport.legend) > 0,
  JSON.stringify(beforeReport),
);

// Capture adjustments for file A only.
await page.evaluate((id) => {
  localStorage.setItem('fs-capture-sizes:' + id, JSON.stringify({
    pointLabelFontSize: 18,
    highLowPinSize: 20,
    legendScale: 2.4,
    legendX: 24,
    legendY: 24,
    statsPillSize: 56,
    pointSize: 5,
  }));
  localStorage.setItem('stats-chip-size:' + id, '56');
  localStorage.setItem('dpp-font:' + id, '18');
  localStorage.setItem('topo.legend.v1:' + id, JSON.stringify({ scale: 2.4, x: 24, y: 24 }));
}, a.id);

const afterCaptureA = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  return {
    pill: rec.reportBuilder?.floorLayout?.pillLock?.scale,
    legend: rec.reportBuilder?.floorLayout?.legendLock?.scale,
    capturePill: localStorage.getItem('stats-chip-size:' + id),
    captureFont: localStorage.getItem('dpp-font:' + id),
  };
}, a.id);
check(
  '1) Capture size change does not alter report floorLayout',
  afterCaptureA.pill === beforeReport.pill && afterCaptureA.legend === beforeReport.legend,
  JSON.stringify({ beforeReport, afterCaptureA }),
);

// Change report pill lock for A; capture keys and file B must stay put.
const reportChanged = await page.evaluate(async ({ id, chrome }) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const nextScale = chrome * (48 / 32); // 48px sheet equivalent
  rec.reportBuilder.floorLayout.pillLock = { locked: true, scale: nextScale };
  rec.reportBuilder.floorLayout.legendLock = { locked: true, scale: 0.8 };
  await window.ToolboxDB.saveCustomerFile(rec);
  return {
    pill: nextScale,
    legend: 0.8,
    capturePill: localStorage.getItem('stats-chip-size:' + id),
    captureFont: localStorage.getItem('dpp-font:' + id),
  };
}, { id: a.id, chrome: a.chrome });

const bCapture = await page.evaluate((id) => ({
  sizes: localStorage.getItem('fs-capture-sizes:' + id),
  pill: localStorage.getItem('stats-chip-size:' + id),
  font: localStorage.getItem('dpp-font:' + id),
}), b.id);

check(
  '2a) Report size change leaves capture keys for that file alone',
  reportChanged.capturePill === '56' && reportChanged.captureFont === '18',
  JSON.stringify(reportChanged),
);
check(
  '2b) Report size change does not create capture sizes for another Customer File',
  !bCapture.sizes && !bCapture.pill && !bCapture.font,
  JSON.stringify(bCapture),
);

const bReport = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  return {
    pill: rec.reportBuilder?.floorLayout?.pillLock?.scale,
    legend: rec.reportBuilder?.floorLayout?.legendLock?.scale,
  };
}, b.id);
check(
  '2c) Another Customer File report locks stay at their seed',
  Math.abs(Number(bReport.pill) - Number(b.pillScale)) < 1e-6 && Number(bReport.legend) === 1.2,
  JSON.stringify({ bReport, seed: b.pillScale }),
);

// Open report A and confirm drawn pillPx ignores device-global 96.
await page.goto(BASE + `#/file/${a.id}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => document.querySelector('.rb-thumb[data-page-id^="floor-"]'),
  { timeout: 25000 },
).catch(() => null);
await page.evaluate(() => document.querySelector('.rb-thumb[data-page-id^="floor-"]')?.click());
await new Promise((r) => setTimeout(r, 2000));
if (await page.$('[data-rb-floor-import]')) {
  await page.click('[data-rb-floor-import]');
  await page.waitForFunction(() => !!document.querySelector('[data-rb-floor-box^="topo"]'), {
    timeout: 30000,
  }).catch(() => null);
  await new Promise((r) => setTimeout(r, 1500));
}

const live = await page.evaluate(() => {
  const pill = document.querySelector(
    '.rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-box^="pill"]',
  );
  if (!pill) return { open: false };
  const t = pill.style.transform || '';
  const m = /scale\(([^)]+)\)/.exec(t);
  return {
    open: true,
    scale: m ? Number(m[1]) : null,
    globalPoison: localStorage.getItem('stats-chip-size'),
  };
});
check(
  'Report sheet draws pill from layout (~48px scale), not device-global 96',
  live.open &&
    live.globalPoison === '96' &&
    live.scale != null &&
    Math.abs(live.scale - reportChanged.pill) < 0.05,
  JSON.stringify({ live, expect: reportChanged.pill }),
);

// Reopen persistence: reload and re-read storage + record.
await page.goto(BASE, { waitUntil: 'networkidle0' });
const reopened = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  return {
    pill: rec.reportBuilder?.floorLayout?.pillLock?.scale,
    legend: rec.reportBuilder?.floorLayout?.legendLock?.scale,
    capture: JSON.parse(localStorage.getItem('fs-capture-sizes:' + id) || 'null'),
  };
}, a.id);
check(
  '3) Reopen keeps report locks and capture sizes for that file',
  Math.abs(Number(reopened.pill) - Number(reportChanged.pill)) < 1e-6 &&
    Number(reopened.legend) === 0.8 &&
    reopened.capture &&
    reopened.capture.statsPillSize === 56 &&
    reopened.capture.pointLabelFontSize === 18 &&
    reopened.capture.legendScale === 2.4,
  JSON.stringify(reopened),
);

await page.screenshot({ path: `${OUT}/sizing-ownership-report.png` });

const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `FAILED ${failed.length}/${results.length}` : `ALL PASSED ${results.length}`);
await browser.close();
process.exit(failed.length ? 1 : 0);
