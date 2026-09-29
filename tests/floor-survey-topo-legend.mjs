/**
 * Floor Survey Topo legend + H/L/Δ regression.
 *
 * Proven baseline (floorplan-topo-maker 0865c5c): Legend ON draws the
 * color/elevation legend, and Topo shows the floating H / L / Δ chip.
 * A later donor change hid the legend in the combined multi-area view and
 * dropped the Topo chip.
 *
 * Synthetic Customer File only. Run: node tests/floor-survey-topo-legend.mjs
 *   --before   save the current-bundle screenshots and do not fail
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('/tmp/node_modules/puppeteer-core');
}

const BEFORE = process.argv.includes('--before');
const PHASE = BEFORE ? 'before' : 'after';
const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' — ' + detail : ''));
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const topoSrc = read('floor-survey/src/components/tabs/TopoTab.tsx');
const hostSrc = read('floor-survey/src/host/HostWorkspace.tsx');
const routeSrc = read('floor-survey/src/routes/projects.$id.tsx');

check(
  'Every visible boundary draws its own color legend',
  topoSrc.includes('export function areaLegendAnchor') &&
    topoSrc.includes('function areaLegendBox') &&
    topoSrc.includes('Every visible contour surface gets its own legend') &&
    topoSrc.includes('areaLegendBox(at.area, resolved, live)') &&
    !topoSrc.includes('showLegend && soloGrid') &&
    !topoSrc.includes('Shared color legend is suppressed') &&
    !topoSrc.includes('sharedLegend'),
);
check(
  'Single-boundary legend path and level-vs-boundary comments remain',
  topoSrc.includes('export function legendGridFor') &&
    topoSrc.includes('A Customer File level is not a topo boundary') &&
    hostSrc.includes('A topo boundary is drawn inside one level and is not a level') &&
    hostSrc.includes('data-floor-selector'),
);
check(
  'Boundary H/L/Δ pills drag immediately without a long-press',
  topoSrc.includes('const immediate = hit.kind === "pill"') &&
    topoSrc.includes('active: immediate'),
);
check(
  'Topo boundary selector pill is draggable',
  topoSrc.includes('Topo boundary selector — drag to move') &&
    topoSrc.includes('BOUNDARY_SELECT_KEY'),
);
function chipBlock(src) {
  const marker = 'mode === "topo" ? "topo" : "data"';
  const start = src.indexOf(marker);
  const end = src.indexOf('<DataPointsPanel', start);
  return start >= 0 && end > start ? src.slice(start, end) : '';
}
for (const [name, src] of [
  ['HostWorkspace', hostSrc],
  ['projects route', routeSrc],
]) {
  const block = chipBlock(src);
  check(
    `${name} shows the floating H/L/Δ chip in Topo`,
    block.includes('<StatsChip') &&
      block.includes('mode === "topo"') &&
      !/\{mode === "field" && \(\s*\n\s*<StatsChip/.test(block),
    block.includes('<StatsChip') ? 'chip present' : 'chip missing from Data/Topo chrome',
  );
}

const PLAN_W = 900;
const PLAN_H = 700;
const AREA_A = [
  { x: 220, y: 30 },
  { x: 860, y: 30 },
  { x: 860, y: 320 },
  { x: 220, y: 320 },
];
const AREA_B = [
  { x: 220, y: 360 },
  { x: 860, y: 360 },
  { x: 860, y: 660 },
  { x: 220, y: 660 },
];

function point(id, index, x, y, value, base) {
  return {
    id,
    floorId: 'canvas-topo-legend',
    index,
    x,
    y,
    value,
    isBasePoint: !!base,
    label: base ? 'BP1' : undefined,
    createdAt: 1,
  };
}

const POINTS = [
  point('p1', 1, 300, 100, 1.0, true),
  point('p2', 2, 520, 140, 1.6, false),
  point('p3', 3, 740, 180, 2.1, false),
  point('p4', 4, 400, 260, 1.3, false),
  point('p5', 5, 320, 430, 3.2, false),
  point('p6', 6, 540, 500, 3.8, false),
  point('p7', 7, 760, 560, 4.6, false),
  point('p8', 8, 420, 620, 3.4, false),
];

fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});

async function openTopo(page, areas) {
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  });
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  const seeded = await page.evaluate(
    async ({ planW, planH, areas, points }) => {
      localStorage.removeItem('topo.legend.v1');
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('stats-chip-pos:')) localStorage.removeItem(key);
      }
      const c = document.createElement('canvas');
      c.width = planW;
      c.height = planH;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#cfc6b8';
      ctx.fillRect(0, 0, planW, planH);
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(2, 2, 12, 12);
      ctx.fillStyle = '#0000ff';
      ctx.fillRect(planW - 14, 2, 12, 12);
      const planPng = c.toDataURL('image/png');
      const id = 'cf-topo-legend';
      const canvasId = 'canvas-topo-legend';
      const planId = 'plan-topo-legend';
      await window.ToolboxDB.putMedia(planId, planPng);
      const rec = window.ToolboxApp.blankCustomerFile(id);
      window.ToolboxPlanSetup.ensurePlanSetup(rec);
      rec.firstName = 'Topo';
      rec.lastName = 'Legend';
      rec.propertyAddress = '1 Synthetic Way';
      const nowIso = new Date().toISOString();
      rec.planSetup.canvases = [
        {
          id: canvasId,
          name: 'Main Level',
          createdAt: nowIso,
          updatedAt: nowIso,
          plan: { id: planId, width: planW, height: planH },
          rooms: [],
          frontDoorFacing: 'S',
          frontDoor: null,
        },
      ];
      rec.planSetup.activeCanvasId = canvasId;
      window.ToolboxPlanSetup.ensureFloorSurvey(rec);
      window.ToolboxPlanSetup.ensureFloorSurveyCanvasRef(rec, canvasId);
      const now = Date.now();
      rec.floorSurvey.byCanvasId[canvasId] = {
        canvasId,
        boundary: areas[0].polygon,
        areas: areas.map((a) => ({ ...a, createdAt: now })),
        points,
        createdAt: now,
        updatedAt: now,
      };
      await window.ToolboxDB.saveCustomerFile(rec);
      return { id, canvasId };
    },
    { planW: PLAN_W, planH: PLAN_H, areas, points: POINTS.filter((p) => areas.length > 1 || p.index <= 4) },
  );

  await page.goto(BASE + `#/file/${seeded.id}/floor`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(
    () => [...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === 'Topo'),
    { timeout: 15000 },
  );
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Topo')?.click();
  });
  await page.waitForFunction(() => document.querySelector('canvas'), { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 1800));
  return seeded;
}

function sampleLegend(page, legendOrigin = { x: 24, y: 24 }, scaleHint = 1.5) {
  return page.evaluate(
    ({ origin, scaleHint: s }) => {
      const canvases = [...document.querySelectorAll('canvas')];
      const canvas = canvases.sort((a, b) => b.width * b.height - a.width * a.height)[0];
      if (!canvas) return { ok: false, reason: 'no canvas' };
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const { width, height } = canvas;
      let img;
      try {
        img = ctx.getImageData(0, 0, width, height);
      } catch (err) {
        return { ok: false, reason: 'getImageData ' + err.message };
      }
      const data = img.data;
      let redN = 0;
      let blueN = 0;
      let redX = 0;
      let redY = 0;
      let blueX = 0;
      let blueY = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          if (r > 220 && g < 40 && b < 40) {
            redN++;
            redX += x;
            redY += y;
          } else if (b > 220 && r < 40 && g < 40) {
            blueN++;
            blueX += x;
            blueY += y;
          }
        }
      }
      if (redN < 8 || blueN < 8) {
        return { ok: false, reason: 'markers', redN, blueN, width, height };
      }
      const red = { x: redX / redN, y: redY / redN };
      const blue = { x: blueX / blueN, y: blueY / blueN };
      const redImgX = 8;
      const blueImgX = 900 - 8;
      const scale = (blue.x - red.x) / (blueImgX - redImgX);
      const originX = red.x - redImgX * scale;
      const originY = red.y - 8 * scale;
      // Color bar sits inside the legend for both the default 1× box and the
      // hydrated 1.5× box. Image coords, not screen coords.
      const x0 = origin.x + 14 * s;
      const x1 = origin.x + 14 * s + 18 * s;
      const y0 = origin.y + 18 * s;
      const y1 = origin.y + 18 * s + Math.max(40, (226 * s - 42 * s) * 0.65);
      let total = 0;
      let chromatic = 0;
      let sample = null;
      for (let iy = y0; iy <= y1; iy += 4) {
        for (let ix = x0; ix <= x1; ix += 3) {
          const dx = Math.round(originX + ix * scale);
          const dy = Math.round(originY + iy * scale);
          if (dx < 0 || dy < 0 || dx >= width || dy >= height) continue;
          const i = (dy * width + dx) * 4;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const sat = Math.max(r, g, b) - Math.min(r, g, b);
          total++;
          if (sat > 28 && !(r > 220 && g < 50 && b < 50)) chromatic++;
          if (!sample) sample = { r, g, b, sat, dx, dy };
        }
      }
      const ratio = total ? chromatic / total : 0;
      return {
        ok: true,
        ratio,
        chromatic,
        total,
        scale,
        sample,
        legendOrigin: origin,
        legendVisible: ratio > 0.45,
      };
    },
    { origin: legendOrigin, scaleHint },
  );
}

function readChip(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[aria-label="Elevation stats — drag to move"]');
    if (!el) return { present: false, text: '' };
    const style = getComputedStyle(el);
    const text = (el.textContent || '').replace(/\s+/g, '');
    const visible =
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      Number(style.opacity) > 0.5 &&
      el.getBoundingClientRect().width > 40;
    return { present: true, visible, text, opacity: style.opacity };
  });
}

async function legendSwitchState(page) {
  await page.click('[aria-label="Labels & layers"]');
  await new Promise((r) => setTimeout(r, 300));
  return page.evaluate(() => {
    const label = [...document.querySelectorAll('label')].find((n) => (n.textContent || '').trim() === 'Legend');
    const row = label?.parentElement;
    const sw = row?.querySelector('[role="switch"]');
    return {
      found: !!sw,
      checked: sw?.getAttribute('aria-checked') === 'true' || sw?.getAttribute('data-state') === 'checked',
    };
  });
}

const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.setCacheEnabled(false);
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });

const twoAreas = [
  { id: 'area-a', name: 'Boundary 1', polygon: AREA_A },
  { id: 'area-b', name: 'Boundary 2', polygon: AREA_B },
];
// Per-boundary legends sit at each area's top-left anchor (+8,+8).
const LEGEND_A = { x: AREA_A[0].x + 8, y: AREA_A[0].y + 8 };
const LEGEND_B = { x: AREA_B[0].x + 8, y: AREA_B[0].y + 8 };
await openTopo(page, twoAreas);
const legendOn = await legendSwitchState(page);
const combinedA = await sampleLegend(page, LEGEND_A);
const combinedB = await sampleLegend(page, LEGEND_B);
const chip = await readChip(page);
await page.screenshot({ path: path.join(OUT, `topo-legend-${PHASE}-combined-desktop.png`) });

check(
  'Legend control is ON for the synthetic survey',
  legendOn.found && legendOn.checked,
  JSON.stringify(legendOn),
);
check(
  'Combined All boundaries draws a color legend on Boundary 1',
  combinedA.legendVisible === true,
  JSON.stringify(combinedA),
);
check(
  'Combined All boundaries draws a color legend on Boundary 2',
  combinedB.legendVisible === true,
  JSON.stringify(combinedB),
);
check(
  'Topo shows a visible floating H / L / Δ chip',
  chip.present && chip.visible && /H/.test(chip.text) && /L/.test(chip.text) && /Δ/.test(chip.text),
  JSON.stringify(chip),
);
check(
  'Floating chip reports the survey high, low, and delta',
  chip.text.includes('4.60') && chip.text.includes('1.00') && chip.text.includes('3.60'),
  chip.text,
);

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await openTopo(page, twoAreas);
const phoneChip = await readChip(page);
const phoneLegendA = await sampleLegend(page, LEGEND_A);
const phoneLegendB = await sampleLegend(page, LEGEND_B);
await page.screenshot({ path: path.join(OUT, `topo-legend-${PHASE}-combined-phone.png`) });
check(
  'Phone Topo keeps both boundary legends and the H/L/Δ chip on screen',
  phoneLegendA.legendVisible === true &&
    phoneLegendB.legendVisible === true &&
    phoneChip.present &&
    phoneChip.visible,
  JSON.stringify({
    legendA: phoneLegendA.ratio,
    legendB: phoneLegendB.ratio,
    chip: phoneChip.text,
    visible: phoneChip.visible,
  }),
);

await page.setViewport({ width: 768, height: 1024, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await openTopo(page, twoAreas);
const ipadChip = await readChip(page);
const ipadLegendA = await sampleLegend(page, LEGEND_A);
const ipadLegendB = await sampleLegend(page, LEGEND_B);
await page.screenshot({ path: path.join(OUT, `topo-legend-${PHASE}-combined-ipad.png`) });
check(
  'iPad Topo keeps both boundary legends and the H/L/Δ chip on screen',
  ipadLegendA.legendVisible === true &&
    ipadLegendB.legendVisible === true &&
    ipadChip.present &&
    ipadChip.visible,
  JSON.stringify({
    legendA: ipadLegendA.ratio,
    legendB: ipadLegendB.ratio,
    chip: ipadChip.text,
    visible: ipadChip.visible,
  }),
);

// Single closed boundary — legend sits on that boundary's top-left, not (24,24).
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
await openTopo(page, [{ id: 'area-a', name: 'Boundary 1', polygon: AREA_A }]);
const solo = await sampleLegend(page, LEGEND_A);
const soloChip = await readChip(page);
await page.screenshot({ path: path.join(OUT, `topo-legend-${PHASE}-solo-desktop.png`) });
check(
  'Single-area Topo still draws the legend and the H/L/Δ chip',
  solo.legendVisible === true &&
    soloChip.present &&
    soloChip.visible &&
    soloChip.text.includes('2.10') &&
    soloChip.text.includes('1.00'),
  JSON.stringify({ legend: solo.ratio, chip: soloChip.text }),
);

// Focused named boundary (Main Floor / Lower Bedroom case): select one area
// from All boundaries and still get that area's own legend.
await openTopo(page, twoAreas);
await page.select('select[aria-label="Topo boundary"]', 'area-a');
await new Promise((r) => setTimeout(r, 1200));
const focusedA = await sampleLegend(page, LEGEND_A);
const focusedAAway = await sampleLegend(page, LEGEND_B);
await page.screenshot({ path: path.join(OUT, `topo-legend-${PHASE}-focused-a-desktop.png`) });
check(
  'Focused Boundary 1 draws its own legend',
  focusedA.legendVisible === true,
  JSON.stringify(focusedA),
);
check(
  'Focused Boundary 1 does not leave a legend on Boundary 2',
  focusedAAway.legendVisible === false,
  JSON.stringify(focusedAAway),
);
await page.select('select[aria-label="Topo boundary"]', 'area-b');
await new Promise((r) => setTimeout(r, 1200));
const focusedB = await sampleLegend(page, LEGEND_B);
await page.screenshot({ path: path.join(OUT, `topo-legend-${PHASE}-focused-b-desktop.png`) });
check(
  'Focused Boundary 2 draws its own legend',
  focusedB.legendVisible === true,
  JSON.stringify(focusedB),
);

// One Customer File level, one closed topo boundary. Levels and boundaries
// are different controls. This is the case covered by the single-boundary PR.
const ONE_BOUNDARY = [
  { x: 200, y: 70 },
  { x: 860, y: 70 },
  { x: 860, y: 640 },
  { x: 200, y: 640 },
];
const LEGEND_ONE = { x: ONE_BOUNDARY[0].x + 8, y: ONE_BOUNDARY[0].y + 8 };
const ONE_READINGS = [
  { id: 'r1', index: 1, x: 280, y: 160, value: 1.2 },
  { id: 'r2', index: 2, x: 480, y: 200, value: 2.4 },
  { id: 'r3', index: 3, x: 720, y: 240, value: 0.6 },
  { id: 'r4', index: 4, x: 340, y: 420, value: 3.1 },
  { id: 'r5', index: 5, x: 640, y: 500, value: 1.8 },
];

async function openLevels(levelNames) {
  await page.setCacheEnabled(false);
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  const seeded = await page.evaluate(
    async ({ planW, planH, levelNames, polygon, readings }) => {
      localStorage.removeItem('topo.legend.v1');
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('stats-chip-pos:')) localStorage.removeItem(key);
      }
      const c = document.createElement('canvas');
      c.width = planW;
      c.height = planH;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#cfc6b8';
      ctx.fillRect(0, 0, planW, planH);
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(2, 2, 12, 12);
      ctx.fillStyle = '#0000ff';
      ctx.fillRect(planW - 14, 2, 12, 12);
      const planPng = c.toDataURL('image/png');
      const id = 'cf-topo-one-level';
      const rec = window.ToolboxApp.blankCustomerFile(id);
      window.ToolboxPlanSetup.ensurePlanSetup(rec);
      rec.firstName = 'Synthetic';
      rec.lastName = 'Level';
      rec.propertyAddress = '1 Single Boundary Ln';
      const nowIso = new Date().toISOString();
      const now = Date.now();
      const canvases = levelNames.map((name) => {
        const canvasId = 'canvas-' + name.toLowerCase().replace(/\s+/g, '-');
        return {
          id: canvasId,
          name,
          createdAt: nowIso,
          updatedAt: nowIso,
          plan: { id: 'plan-' + canvasId, width: planW, height: planH },
          rooms: [],
          frontDoorFacing: 'S',
          frontDoor: null,
        };
      });
      for (const canvas of canvases) {
        await window.ToolboxDB.putMedia(canvas.plan.id, planPng);
      }
      rec.planSetup.canvases = canvases;
      rec.planSetup.activeCanvasId = canvases[0].id;
      window.ToolboxPlanSetup.ensureFloorSurvey(rec);
      for (const canvas of canvases) {
        window.ToolboxPlanSetup.ensureFloorSurveyCanvasRef(rec, canvas.id);
        rec.floorSurvey.byCanvasId[canvas.id] = {
          canvasId: canvas.id,
          boundary: polygon,
          areas: [{ id: 'boundary-1', name: 'Boundary 1', polygon, createdAt: now }],
          points: readings.map((p) => ({
            ...p,
            id: canvas.id + '-' + p.id,
            floorId: canvas.id,
            createdAt: now,
            isBasePoint: p.index === 1,
            label: p.index === 1 ? 'BP1' : undefined,
          })),
          createdAt: now,
          updatedAt: now,
        };
      }
      await window.ToolboxDB.saveCustomerFile(rec);
      return { id };
    },
    { planW: PLAN_W, planH: PLAN_H, levelNames, polygon: ONE_BOUNDARY, readings: ONE_READINGS },
  );
  await page.goto(BASE + `#/file/${seeded.id}/floor`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(
    () => [...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === 'Topo'),
    { timeout: 15000 },
  );
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Topo')?.click();
  });
  await page.waitForFunction(() => document.querySelector('canvas'), { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 1600));
  return seeded;
}

function readLevelChrome(page) {
  return page.evaluate(() => {
    const text = document.body.innerText || '';
    const floorSel = document.querySelector('[data-floor-selector]');
    const boundarySel = document.querySelector('select[aria-label="Topo boundary"]');
    const stats = document.querySelector('[aria-label="Elevation stats — drag to move"]');
    const box = stats ? stats.getBoundingClientRect() : null;
    const style = stats ? getComputedStyle(stats) : null;
    const visible = !!(
      stats &&
      box &&
      style &&
      box.width > 40 &&
      Number(style.opacity) > 0.5 &&
      box.top >= 0 &&
      box.left >= -2 &&
      box.right <= window.innerWidth + 2 &&
      box.bottom <= window.innerHeight + 2
    );
    return {
      text: text.slice(0, 300),
      hasFloorSelector: !!floorSel,
      floorOptions: floorSel
        ? [...floorSel.querySelectorAll('option')].map((o) => (o.textContent || '').trim())
        : [],
      hasAllBoundaries: !!boundarySel,
      statsText: stats ? (stats.textContent || '').replace(/\s+/g, '') : '',
      statsVisible: visible,
    };
  });
}

function chipClearOfModeToggle(page) {
  return page.evaluate(() => {
    function box(el) {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }
    function overlaps(a, b) {
      if (!a || !b) return false;
      return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
    }
    const stats = box(document.querySelector('[aria-label="Elevation stats — drag to move"]'));
    const data = box([...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Data'));
    const topo = box([...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Topo'));
    return {
      overlaps: overlaps(stats, data) || overlaps(stats, topo),
      stats,
      data,
      topo,
    };
  });
}

await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
await openLevels(['Main Level']);
const oneLevel = await readLevelChrome(page);
const oneLegend = await sampleLegend(page, LEGEND_ONE);
await page.screenshot({ path: path.join(OUT, 'topo-one-level-desktop.png') });
check(
  'One level hides the host floor selector',
  !oneLevel.hasFloorSelector && oneLevel.text.includes('Main Level'),
  oneLevel.text.replace(/\n/g, ' | '),
);
check(
  'One closed boundary does not show All boundaries',
  !oneLevel.hasAllBoundaries,
  String(oneLevel.hasAllBoundaries),
);
check(
  'One boundary, Legend ON paints the color legend',
  oneLegend.legendVisible === true,
  JSON.stringify(oneLegend),
);
check(
  'One boundary shows floating H / L / Δ for that level',
  oneLevel.statsVisible &&
    oneLevel.statsText.includes('H') &&
    oneLevel.statsText.includes('L') &&
    oneLevel.statsText.includes('Δ') &&
    oneLevel.statsText.includes('3.10') &&
    oneLevel.statsText.includes('0.60') &&
    oneLevel.statsText.includes('2.50'),
  oneLevel.statsText,
);

await page.click('[aria-label="Labels & layers"]');
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => {
  const label = [...document.querySelectorAll('label')].find((n) => (n.textContent || '').trim() === 'Legend');
  label?.parentElement?.querySelector('[role="switch"]')?.click();
});
await new Promise((r) => setTimeout(r, 500));
const legendOff = await sampleLegend(page, LEGEND_ONE);
check(
  'Legend OFF removes the color legend on one boundary',
  legendOff.ok && legendOff.legendVisible !== true && legendOff.ratio < 0.2,
  JSON.stringify(legendOff),
);
await page.evaluate(() => {
  const label = [...document.querySelectorAll('label')].find((n) => (n.textContent || '').trim() === 'Legend');
  label?.parentElement?.querySelector('[role="switch"]')?.click();
});
await new Promise((r) => setTimeout(r, 500));
const legendRestored = await sampleLegend(page, LEGEND_ONE);
check(
  'Legend ON restores the color legend on one boundary',
  legendRestored.legendVisible === true,
  JSON.stringify(legendRestored),
);
await page.evaluate(() => {
  [...document.querySelectorAll('button[aria-label="Close"]')].forEach((b) => b.click());
});

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await openLevels(['Main Level']);
const phoneOne = await readLevelChrome(page);
const phoneOneLegend = await sampleLegend(page, LEGEND_ONE);
const phoneClear = await chipClearOfModeToggle(page);
await page.screenshot({ path: path.join(OUT, 'topo-one-level-phone.png') });
check(
  'Phone: one level, one boundary keeps legend and H/L/Δ clear of Data/Topo',
  phoneOne.statsVisible &&
    phoneOne.statsText.includes('3.10') &&
    phoneOneLegend.legendVisible === true &&
    !phoneOne.hasFloorSelector &&
    !phoneOne.hasAllBoundaries &&
    phoneClear.overlaps === false,
  JSON.stringify({ stats: phoneOne.statsText, legend: phoneOneLegend.ratio, clear: phoneClear }),
);

await page.setViewport({ width: 768, height: 1024, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await openLevels(['Main Level']);
const ipadOne = await readLevelChrome(page);
const ipadOneLegend = await sampleLegend(page, LEGEND_ONE);
const ipadClear = await chipClearOfModeToggle(page);
await page.screenshot({ path: path.join(OUT, 'topo-one-level-ipad.png') });
check(
  'iPad: one level, one boundary keeps legend and H/L/Δ clear of Data/Topo',
  ipadOne.statsVisible &&
    ipadOne.statsText.includes('Δ2.50') &&
    ipadOneLegend.legendVisible === true &&
    !ipadOne.hasAllBoundaries &&
    ipadClear.overlaps === false,
  JSON.stringify({ stats: ipadOne.statsText, legend: ipadOneLegend.ratio, clear: ipadClear }),
);

await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
await openLevels(['Main Level', 'Basement']);
const twoLevels = await readLevelChrome(page);
const mainLegend = await sampleLegend(page, LEGEND_ONE);
check(
  'Two Customer File levels show the host floor selector',
  twoLevels.hasFloorSelector && twoLevels.floorOptions.join('|') === 'Main Level|Basement',
  twoLevels.floorOptions.join('|'),
);
check(
  'Floor selector is not the topo All boundaries control',
  !twoLevels.hasAllBoundaries && twoLevels.text.includes('Main Level') && mainLegend.legendVisible === true,
  twoLevels.text.slice(0, 120),
);
await page.select('[data-floor-selector] select', 'canvas-basement');
await page.waitForFunction(
  () => (document.body.innerText || '').includes('Basement'),
  { timeout: 8000 },
);
await new Promise((r) => setTimeout(r, 1200));
const basement = await readLevelChrome(page);
const basementLegend = await sampleLegend(page, LEGEND_ONE);
await page.screenshot({ path: path.join(OUT, 'topo-two-levels-desktop.png') });
check(
  'Switching levels keeps that level’s own legend and H/L/Δ',
  basement.text.includes('Basement') &&
    !basement.hasAllBoundaries &&
    basement.hasFloorSelector &&
    basement.statsVisible &&
    basement.statsText.includes('3.10') &&
    basement.statsText.includes('0.60') &&
    basementLegend.legendVisible === true,
  basement.text.slice(0, 160) + ' ' + basement.statsText,
);

await browser.close();

const failed = results.filter((r) => !r.ok);
fs.writeFileSync(
  path.join(OUT, `topo-legend-${PHASE}-results.json`),
  JSON.stringify({ phase: PHASE, failed: failed.length, results }, null, 2),
);
console.log(`\n${results.length - failed.length}/${results.length} passed (${PHASE})`);
if (!BEFORE && failed.length) process.exit(1);
