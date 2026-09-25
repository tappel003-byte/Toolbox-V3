/**
 * Single-level / single-boundary Topo legend and H / L / Δ.
 * Levels and topo boundaries are different controls.
 * Run: node tests/floor-survey-topo-legend.mjs
 */
import { createRequire } from 'module';
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
fs.mkdirSync(OUT, { recursive: true });

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

const PLAN_W = 800;
const PLAN_H = 600;
const POLYGON = [
  { x: 80, y: 80 },
  { x: 720, y: 80 },
  { x: 720, y: 520 },
  { x: 80, y: 520 },
];
const READINGS = [
  { id: 'p1', index: 1, x: 180, y: 180, value: 1.2 },
  { id: 'p2', index: 2, x: 400, y: 200, value: 2.4 },
  { id: 'p3', index: 3, x: 620, y: 220, value: 0.6 },
  { id: 'p4', index: 4, x: 240, y: 400, value: 3.1 },
  { id: 'p5', index: 5, x: 520, y: 420, value: 1.8 },
];

async function seed(levelNames) {
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  return page.evaluate(async ({ levelNames, polygon, readings, planW, planH }) => {
    localStorage.removeItem('topo.legend.v1');
    localStorage.removeItem('stats-chip-size');
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('stats-chip-pos:')) localStorage.removeItem(key);
    }
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
    const c = document.createElement('canvas');
    c.width = planW;
    c.height = planH;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f7f4ee';
    ctx.fillRect(0, 0, planW, planH);
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 3;
    ctx.strokeRect(40, 40, planW - 80, planH - 80);
    const planPng = c.toDataURL('image/png');
    const id = 'fs-legend-single';
    let rec = window.ToolboxApp.blankCustomerFile(id);
    window.ToolboxPlanSetup.ensurePlanSetup(rec);
    rec.firstName = 'Synthetic';
    rec.lastName = 'Sipert';
    rec.propertyAddress = '1 Single Boundary Ln';
    const now = Date.now();
    const canvases = [];
    for (const name of levelNames) {
      const canvasId = 'canvas-' + name.toLowerCase().replace(/\s+/g, '-');
      const planId = 'plan-' + canvasId;
      await window.ToolboxDB.putMedia(planId, planPng);
      canvases.push({
        id: canvasId,
        name,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        plan: { id: planId, width: planW, height: planH },
        rooms: [],
        frontDoorFacing: 'S',
        frontDoor: null,
      });
      window.ToolboxPlanSetup.ensureFloorSurveyCanvasRef(rec, canvasId);
      rec.floorSurvey.byCanvasId[canvasId] = {
        canvasId,
        boundary: polygon.map((p) => ({ ...p })),
        areas: [{
          id: 'boundary-1',
          name: 'Boundary 1',
          polygon: polygon.map((p) => ({ ...p })),
          createdAt: now,
        }],
        points: readings.map((p) => ({
          ...p,
          id: canvasId + '-' + p.id,
          floorId: canvasId,
          createdAt: now,
        })),
        createdAt: now,
        updatedAt: now,
      };
    }
    rec.planSetup.canvases = canvases;
    rec.planSetup.activeCanvasId = canvases[0].id;
    window.ToolboxPlanSetup.ensurePlanSetup(rec);
    await window.ToolboxDB.saveCustomerFile(rec);
    return { id };
  }, { levelNames, polygon: POLYGON, readings: READINGS, planW: PLAN_W, planH: PLAN_H });
}

async function openTopo(id) {
  await page.goto(BASE + `#/file/${id}/floor`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 900));
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Topo')?.click();
  });
  await new Promise((r) => setTimeout(r, 1400));
}

function sampleLegend() {
  return page.evaluate(({ planW, planH }) => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return { ok: false, reason: 'no canvas' };
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const s = Math.min(rect.width / planW, rect.height / planH);
    const tx = (rect.width - planW * s) / 2;
    const ty = (rect.height - planH * s) / 2;
    // Inside the default legend color bar (image 24,24 at 1.5×).
    // Color bar of the default legend, left of the boundary (boundary starts at x=80).
    let sat = 0;
    let rgba = [0, 0, 0];
    let sx = 0;
    let sy = 0;
    for (let iy = 60; iy <= 280; iy += 8) {
      for (let ix = 42; ix <= 70; ix += 4) {
        const px = Math.round((tx + ix * s) * dpr);
        const py = Math.round((ty + iy * s) * dpr);
        if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) continue;
        const p = ctx.getImageData(px, py, 1, 1).data;
        const sampleSat = Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]);
        if (sampleSat > sat) {
          sat = sampleSat;
          rgba = [p[0], p[1], p[2]];
          sx = px;
          sy = py;
        }
      }
    }
    return { ok: true, rgba, sat, sx, sy, css: { w: rect.width, h: rect.height } };
  }, { planW: PLAN_W, planH: PLAN_H });
}

function readChrome() {
  return page.evaluate(() => {
    const text = document.body.innerText || '';
    const floorSel = document.querySelector('[data-floor-selector]');
    const boundarySel = [...document.querySelectorAll('select')].find((s) =>
      [...s.options].some((o) => /All boundaries/i.test(o.textContent || '')),
    );
    const stats = document.querySelector('[aria-label="Elevation stats — drag to move"]');
    const box = stats ? stats.getBoundingClientRect() : null;
    const visible = !!(
      stats &&
      box &&
      box.width > 20 &&
      box.height > 10 &&
      getComputedStyle(stats).opacity !== '0' &&
      box.bottom > 0 &&
      box.top < window.innerHeight
    );
    const header = text.split('\n')[0] || '';
    return {
      header,
      hasFloorSelector: !!floorSel,
      floorOptions: floorSel
        ? [...floorSel.querySelectorAll('option')].map((o) => o.textContent.trim())
        : [],
      hasAllBoundaries: !!boundarySel,
      statsText: stats ? (stats.textContent || '').replace(/\s+/g, '') : '',
      statsVisible: visible,
    };
  });
}

await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
const one = await seed(['Main Level']);
await openTopo(one.id);
const desktop = await readChrome();
const legendOn = await sampleLegend();
check(
  'Single level hides the host floor selector',
  !desktop.hasFloorSelector,
  desktop.header,
);
check(
  'Single boundary does not show All boundaries',
  !desktop.hasAllBoundaries,
  String(desktop.hasAllBoundaries),
);
check(
  'Legend ON paints the color legend on a single boundary',
  legendOn.ok && legendOn.sat > 40,
  JSON.stringify(legendOn),
);
check(
  'Topo shows floating H / L / Δ',
  desktop.statsVisible &&
    desktop.statsText.includes('H') &&
    desktop.statsText.includes('L') &&
    desktop.statsText.includes('Δ') &&
    desktop.statsText.includes('3.10') &&
    desktop.statsText.includes('0.60'),
  desktop.statsText,
);
await page.screenshot({ path: `${OUT}/topo-after-single-boundary-desktop.png` });

await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === 'Labels & layers')?.click();
});
await new Promise((r) => setTimeout(r, 300));
const legendControl = await page.evaluate(() => {
  const label = [...document.querySelectorAll('label')].find((el) => (el.textContent || '').trim() === 'Legend');
  const row = label?.parentElement;
  const sw = row?.querySelector('[role="switch"]');
  return { found: !!sw, checked: sw?.getAttribute('data-state') || '' };
});
check('Legend control is ON for the single boundary', legendControl.checked === 'checked', JSON.stringify(legendControl));
await page.evaluate(() => {
  const label = [...document.querySelectorAll('label')].find((el) => (el.textContent || '').trim() === 'Legend');
  label?.parentElement?.querySelector('[role="switch"]')?.click();
});
await new Promise((r) => setTimeout(r, 400));
const legendOff = await sampleLegend();
check(
  'Legend OFF removes the color legend',
  legendOff.ok && legendOff.sat < 20,
  JSON.stringify(legendOff),
);
await page.evaluate(() => {
  const label = [...document.querySelectorAll('label')].find((el) => (el.textContent || '').trim() === 'Legend');
  label?.parentElement?.querySelector('[role="switch"]')?.click();
});
await new Promise((r) => setTimeout(r, 400));
const legendBack = await sampleLegend();
check('Legend ON again restores the color legend', legendBack.ok && legendBack.sat > 40, JSON.stringify(legendBack));

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
await openTopo(one.id);
const phone = await readChrome();
const phoneLayout = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  const stats = document.querySelector('[aria-label="Elevation stats — drag to move"]');
  const topo = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Topo');
  const data = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Data');
  function box(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }
  function overlaps(a, b) {
    if (!a || !b) return false;
    return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
  }
  const statsBox = box(stats);
  const topoBox = box(topo);
  const dataBox = box(data);
  let legendRun = 0;
  if (canvas) {
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const step = 4;
    for (let x = 0; x < canvas.width; x += step) {
      let run = 0;
      for (let y = 0; y < canvas.height; y += step) {
        const i = (y * canvas.width + x) * 4;
        const s = Math.max(img.data[i], img.data[i + 1], img.data[i + 2]) - Math.min(img.data[i], img.data[i + 1], img.data[i + 2]);
        if (s > 50) run += 1;
      }
      if (run > legendRun) legendRun = run;
    }
  }
  const onScreen = !!(
    statsBox &&
    statsBox.w > 20 &&
    statsBox.x >= -2 &&
    statsBox.y >= 0 &&
    statsBox.x + statsBox.w <= window.innerWidth + 2 &&
    statsBox.y + statsBox.h <= window.innerHeight + 2
  );
  return {
    legendRun,
    onScreen,
    overlapsToggle: overlaps(statsBox, topoBox) || overlaps(statsBox, dataBox),
    statsBox,
    topoBox,
  };
});
check(
  'Phone: single boundary still shows legend and H / L / Δ',
  phone.statsVisible &&
    phone.statsText.includes('Δ') &&
    phoneLayout.legendRun >= 12 &&
    phoneLayout.onScreen &&
    !phoneLayout.overlapsToggle &&
    !phone.hasAllBoundaries &&
    !phone.hasFloorSelector,
  JSON.stringify({ stats: phone.statsText, layout: phoneLayout, floor: phone.hasFloorSelector }),
);
await page.screenshot({ path: `${OUT}/topo-after-single-boundary-phone.png` });

await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
const two = await seed(['Main Level', 'Basement']);
await openTopo(two.id);
const levels = await readChrome();
const levelLegend = await sampleLegend();
check(
  'Two levels show the host floor selector',
  levels.hasFloorSelector && levels.floorOptions.join('|') === 'Main Level|Basement',
  levels.floorOptions.join('|'),
);
check(
  'Floor selector is not the topo All boundaries control',
  !levels.hasAllBoundaries,
  String(levels.hasAllBoundaries),
);
check(
  'Active level still shows its own legend and H / L / Δ',
  levels.header.includes('Main Level') && levels.statsVisible && levels.statsText.includes('Δ') && levelLegend.sat > 40,
  levels.header + ' ' + levels.statsText,
);
await page.select('[data-floor-selector] select', 'canvas-basement');
await new Promise((r) => setTimeout(r, 800));
const basement = await readChrome();
const basementLegend = await sampleLegend();
check(
  'Host floor selector switches levels without turning a level into a boundary',
  basement.header.includes('Basement') && !basement.hasAllBoundaries && basement.statsVisible && basementLegend.sat > 40,
  basement.header,
);
await page.screenshot({ path: `${OUT}/topo-after-two-levels-desktop.png` });

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
