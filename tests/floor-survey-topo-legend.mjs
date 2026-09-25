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
  'Legend draw path is not limited to a single area',
  topoSrc.includes('export function legendGridFor') &&
    topoSrc.includes('if (resolved.showLegend && legendGrid)') &&
    !topoSrc.includes('showLegend && soloGrid') &&
    !topoSrc.includes('Shared color legend is suppressed'),
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

function sampleLegend(page) {
  return page.evaluate(() => {
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
    let red = null;
    let blue = null;
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
    red = { x: redX / redN, y: redY / redN };
    blue = { x: blueX / blueN, y: blueY / blueN };
    const redImgX = 8;
    const blueImgX = 900 - 8;
    const scale = (blue.x - red.x) / (blueImgX - redImgX);
    const originX = red.x - redImgX * scale;
    const originY = red.y - 8 * scale;
    // Color bar sits inside the legend for both the default 1× box and the
    // hydrated 1.5× box. Image coords, not screen coords.
    const x0 = 48;
    const x1 = 68;
    const y0 = 90;
    const y1 = 200;
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
      legendVisible: ratio > 0.45,
    };
  });
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
await openTopo(page, twoAreas);
const legendOn = await legendSwitchState(page);
const combined = await sampleLegend(page);
const chip = await readChip(page);
await page.screenshot({ path: path.join(OUT, `topo-legend-${PHASE}-combined-desktop.png`) });

check(
  'Legend control is ON for the synthetic survey',
  legendOn.found && legendOn.checked,
  JSON.stringify(legendOn),
);
check(
  'Combined multi-area Topo draws a visible color legend when Legend is ON',
  combined.legendVisible === true,
  JSON.stringify(combined),
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
const phoneLegend = await sampleLegend(page);
await page.screenshot({ path: path.join(OUT, `topo-legend-${PHASE}-combined-phone.png`) });
check(
  'Phone Topo keeps the legend and the H/L/Δ chip on screen',
  phoneLegend.legendVisible === true && phoneChip.present && phoneChip.visible,
  JSON.stringify({ legend: phoneLegend.ratio, chip: phoneChip.text, visible: phoneChip.visible }),
);

await page.setViewport({ width: 768, height: 1024, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await openTopo(page, twoAreas);
const ipadChip = await readChip(page);
const ipadLegend = await sampleLegend(page);
await page.screenshot({ path: path.join(OUT, `topo-legend-${PHASE}-combined-ipad.png`) });
check(
  'iPad Topo keeps the legend and the H/L/Δ chip on screen',
  ipadLegend.legendVisible === true && ipadChip.present && ipadChip.visible,
  JSON.stringify({ legend: ipadLegend.ratio, chip: ipadChip.text, visible: ipadChip.visible }),
);

// Single closed boundary — the proven one-surface case.
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
await openTopo(page, [{ id: 'area-a', name: 'Boundary 1', polygon: AREA_A }]);
const solo = await sampleLegend(page);
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

await browser.close();

const failed = results.filter((r) => !r.ok);
fs.writeFileSync(
  path.join(OUT, `topo-legend-${PHASE}-results.json`),
  JSON.stringify({ phase: PHASE, failed: failed.length, results }, null, 2),
);
console.log(`\n${results.length - failed.length}/${results.length} passed (${PHASE})`);
if (!BEFORE && failed.length) process.exit(1);
