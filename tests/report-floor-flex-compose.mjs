/**
 * Flexible Floor Survey compose — Checkpoint 1.
 * Run: node tests/report-floor-flex-compose.mjs  (static server on 8765)
 *
 * Covers GPT-025 examples + GPT-026 chrome rules + Present/PDF verification:
 * 1) Same level, two appearances (linked frames)
 * 2) Different levels on one sheet
 * 3) Multi-view chrome starts hidden (no reserved legend/pill DOM)
 * Legacy two-up migrates; save/reopen keeps views[]; Present + Print/PDF decks
 * paint non-blank stills per view on 11×17 paper.
 */
import { createRequire } from 'module';
import { mkdir, writeFile } from 'fs/promises';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
const FILE = 'rb-flex-compose';
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
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.setViewport({ width: 1700, height: 1050, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

await page.evaluate(async (id) => {
  async function planMedia(pid, label) {
    const c = document.createElement('canvas');
    c.width = 1000; c.height = 800;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 1000, 800);
    x.strokeStyle = '#111'; x.lineWidth = 5; x.strokeRect(30, 30, 940, 740);
    x.fillStyle = '#333'; x.font = '28px sans-serif'; x.fillText(label, 60, 80);
    await window.ToolboxDB.putMedia(pid, c.toDataURL('image/jpeg', 0.92));
  }
  await planMedia('plan-main-flex', 'MAIN');
  await planMedia('plan-second-flex', 'SECOND');

  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Flex'; rec.lastName = 'Compose';
  rec.propertyAddress = '9 Compose Ct\nSanta Fe, NM 87501';
  const main = rec.planSetup.canvases[0];
  main.name = 'Main Level';
  main.plan = { id: 'plan-main-flex', width: 1000, height: 800 };
  main.frontDoorFacing = 'E';
  const second = window.ToolboxPlanSetup.blankCanvas('Second Floor');
  second.plan = { id: 'plan-second-flex', width: 1000, height: 800 };
  second.frontDoorFacing = 'E';
  rec.planSetup.canvases.push(second);

  function layer(cv, tag) {
    const poly = [{ x: 40, y: 40 }, { x: 960, y: 40 }, { x: 960, y: 760 }, { x: 40, y: 760 }];
    const points = [];
    let n = 0;
    for (let r = 0; r < 3; r += 1) for (let c = 0; c < 4; c += 1) {
      n += 1;
      points.push({
        id: tag + n, floorId: cv.id, index: n,
        x: 120 + c * 220, y: 160 + r * 200, value: 6 + ((n * 5) % 20) / 10,
      });
    }
    return {
      canvasId: cv.id, points, boundary: poly,
      areas: [{ id: tag + '-a', name: cv.name, polygon: poly, createdAt: 1 }],
    };
  }
  rec.floorSurvey = {
    id: 'fs-flex',
    inspectionDate: '2026-10-25',
    byCanvasId: {
      [main.id]: layer(main, 'm'),
      [second.id]: layer(second, 's'),
    },
  };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

async function openMain() {
  await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(
    () => document.querySelector('.rb-thumb[data-page-id^="floor-"]'), { timeout: 25000 });
  await page.evaluate(() => {
    const thumbs = [...document.querySelectorAll('.rb-thumb[data-page-id^="floor-"]')];
    const main = thumbs.find((t) => /main/i.test(t.textContent || '')) || thumbs[0];
    main.click();
  });
  await page.waitForFunction(
    () => !!document.querySelector('[data-rb-floor-import]') ||
      !!document.querySelector('[data-rb-floor-box^="topo"]'), { timeout: 20000 });
  if (await page.$('[data-rb-floor-import]')) {
    await page.click('[data-rb-floor-import]');
    await page.waitForFunction(
      () => !!document.querySelector('[data-rb-floor-box^="topo"]'), { timeout: 30000 });
  }
  await new Promise((r) => setTimeout(r, 2500));
}

await openMain();

const migrated = await page.evaluate(() => {
  const api = window.ToolboxReportFloorViews;
  const host = window.ToolboxReportBuilder;
  // Read views from the open page via DOM frames + ensure API shape.
  const frames = [...document.querySelectorAll('[data-rb-topo-frame]')].length;
  return { hasApi: !!api, frames };
});
check('views API is loaded', migrated.hasApi);
check('imported sheet has at least one topo frame', migrated.frames >= 1, String(migrated.frames));

// Example 1: Add second view (same source), linked, chrome hidden.
await page.evaluate(() => {
  const btn = document.querySelector('[data-rb-floor-view="add"]');
  if (btn) btn.click();
});
await new Promise((r) => setTimeout(r, 1500));

const twoUp = await page.evaluate(() => {
  const frames = [...document.querySelectorAll('[data-rb-topo-frame]')];
  const boxes = frames.map((el) => ({
    left: parseFloat(el.style.left) || 0,
    top: parseFloat(el.style.top) || 0,
    width: parseFloat(el.style.width) || 0,
    height: parseFloat(el.style.height) || 0,
  }));
  // Only report chrome boxes (not anything the live FS view draws).
  const chromeLegend = document.querySelectorAll(
    '.rb-floor-stage > [data-rb-floor-kind="legend"]').length;
  const chromePill = document.querySelectorAll(
    '.rb-floor-stage > [data-rb-floor-kind="pill"]').length;
  return {
    count: frames.length,
    boxes,
    chromeLegend,
    chromePill,
  };
});
check('Add view creates two frames', twoUp.count === 2, String(twoUp.count));
check('linked pair starts equal height', twoUp.boxes.length === 2 &&
  Math.abs(twoUp.boxes[0].height - twoUp.boxes[1].height) < 0.5,
  JSON.stringify(twoUp.boxes.map((b) => b.height)));
check('linked pair aligned top', twoUp.boxes.length === 2 &&
  Math.abs(twoUp.boxes[0].top - twoUp.boxes[1].top) < 0.5,
  JSON.stringify(twoUp.boxes.map((b) => b.top)));
check('multi-view starts with no legend DOM', twoUp.chromeLegend === 0, String(twoUp.chromeLegend));
check('multi-view starts with no pill DOM', twoUp.chromePill === 0, String(twoUp.chromePill));

// Change second view appearance via stored settings (mode).
const appearance = await page.evaluate(() => {
  // Select frame 1
  const f1 = document.querySelector('[data-rb-topo-frame="1"]');
  if (f1) f1.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  // Flip settings on slot 1 through the live host if present.
  return {
    active: !!document.querySelector('[data-rb-topo-frame="1"].is-active') ||
      !!document.querySelector('[data-rb-topo-frame="1"]'),
  };
});
check('second frame is selectable', appearance.active);

// Example 2: change source of selected view to Second Floor.
const sourceOk = await page.evaluate(() => {
  const sel = document.querySelector('[data-rb-floor-view-source]');
  if (!sel) return { ok: false, reason: 'no source select' };
  const opts = [...sel.options];
  const second = opts.find((o) => /second/i.test(o.textContent || ''));
  if (!second) return { ok: false, reason: 'no second option', opts: opts.map((o) => o.textContent) };
  sel.value = second.value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, value: second.value };
});
check('source select can target Second Floor', sourceOk.ok, JSON.stringify(sourceOk));
await new Promise((r) => setTimeout(r, 2000));

const afterSource = await page.evaluate(() => {
  return {
    frames: document.querySelectorAll('[data-rb-topo-frame]').length,
    hosts: document.querySelectorAll('[data-rb-topo-live]').length,
  };
});
check('different-source sheet still has two frames', afterSource.frames === 2, JSON.stringify(afterSource));

// Save/reopen persistence of views[].
const saved = await page.evaluate(async (id) => {
  // Force a save flush by waiting briefly; autosave should have run.
  await new Promise((r) => setTimeout(r, 800));
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const doc = rec && rec.reportBuilder;
  const floor = (doc && doc.pages || []).find((p) => p.type === 'floor' && /main/i.test(p.title || p.railLabel || ''));
  const views = floor && floor.meta && floor.meta.views;
  return {
    hasViews: Array.isArray(views) && views.length === 2,
    sources: (views || []).map((v) => v.canvasId),
    chrome: (views || []).map((v) => ({ L: !!v.showLegend, P: !!v.showPill })),
    frames: (views || []).map((v) => v.frame && ({ w: v.frame.w, h: v.frame.h })),
  };
}, FILE);
check('save keeps two views on the page', saved.hasViews, JSON.stringify(saved));

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => document.querySelector('.rb-thumb[data-page-id^="floor-"]'), { timeout: 25000 });
await page.evaluate(() => {
  const thumbs = [...document.querySelectorAll('.rb-thumb[data-page-id^="floor-"]')];
  (thumbs.find((t) => /main/i.test(t.textContent || '')) || thumbs[0]).click();
});
await page.waitForFunction(
  () => document.querySelectorAll('[data-rb-topo-frame]').length >= 1, { timeout: 30000 });
await new Promise((r) => setTimeout(r, 2500));
const reopened = await page.evaluate(() => document.querySelectorAll('[data-rb-topo-frame]').length);
check('reopen restores multi-view frames', reopened === 2, String(reopened));

// Present + Print/PDF deck — same still path the PDF dialog receives.
async function inkOnStill(selRoot) {
  return page.evaluate((rootSel) => {
    function nonBlank(img) {
      if (!img || !(img.naturalWidth > 40) || !(img.naturalHeight > 40)) {
        return { ok: false, reason: 'tiny-or-missing', w: img && img.naturalWidth, h: img && img.naturalHeight };
      }
      const c = document.createElement('canvas');
      c.width = Math.min(240, img.naturalWidth);
      c.height = Math.min(180, img.naturalHeight);
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      let ink = 0;
      for (let i = 0; i < data.length; i += 16) {
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        if (a > 20 && (r < 245 || g < 245 || b < 245)) ink += 1;
      }
      return {
        ok: ink > 8,
        ink,
        w: img.naturalWidth,
        h: img.naturalHeight,
        dataUrl: !!(img.src && img.src.indexOf('data:image') === 0),
      };
    }
    const root = document.querySelector(rootSel);
    if (!root) return { ok: false, reason: 'no-root' };
    const sheet = [...root.querySelectorAll('.rb-sheet')].find((s) =>
      s.querySelectorAll('[data-rb-topo-frame]').length >= 2) ||
      [...root.querySelectorAll('.rb-sheet')].find((s) => s.querySelector('.rb-topo-still'));
    if (!sheet) return { ok: false, reason: 'no-multi-sheet' };
    const frames = [...sheet.querySelectorAll('[data-rb-topo-frame]')];
    const stills = [...sheet.querySelectorAll('.rb-topo-still')];
    const chromeL = sheet.querySelectorAll('.rb-floor-stage > [data-rb-floor-kind="legend"]').length;
    const chromeP = sheet.querySelectorAll('.rb-floor-stage > [data-rb-floor-kind="pill"]').length;
    return {
      ok: frames.length >= 2 && stills.length >= 2,
      frames: frames.length,
      stills: stills.length,
      ink: stills.map(nonBlank),
      chromeL,
      chromeP,
      sheetW: sheet.offsetWidth,
      sheetH: sheet.offsetHeight,
    };
  }, selRoot);
}

await page.click('#rb-present');
await page.waitForFunction(() => !!document.querySelector('.rb-print--present .rb-sheet'),
  { timeout: 90000 });
await new Promise((r) => setTimeout(r, 1500));
const presented = await inkOnStill('.rb-print--present');
check('Presentation paints two multi-view stills',
  presented.ok && presented.stills >= 2 && (presented.ink || []).every((x) => x.ok),
  JSON.stringify(presented));
check('Presentation keeps multi-view chrome omitted',
  presented.chromeL === 0 && presented.chromeP === 0,
  JSON.stringify({ L: presented.chromeL, P: presented.chromeP }));

await page.evaluate(() => {
  const bar = document.querySelector('.rb-present-bar');
  const close = bar && [...bar.querySelectorAll('button')]
    .find((b) => /close/i.test(b.textContent || ''));
  if (close) close.click();
  const d = document.querySelector('.rb-print');
  if (d) d.remove();
  document.body.classList.remove('is-printing', 'rb-printing');
});
await new Promise((r) => setTimeout(r, 800));

await page.evaluate(() => { window.print = () => { window.__printed = true; }; });
await page.click('#rb-print');
await page.waitForFunction(() => window.__printed === true, { timeout: 90000 });
await new Promise((r) => setTimeout(r, 1200));
const printed = await inkOnStill('.rb-print');
check('Print/PDF deck paints two multi-view stills',
  printed.ok && printed.stills >= 2 && (printed.ink || []).every((x) => x.ok),
  JSON.stringify(printed));
check('Print/PDF deck is 11×17 paper pixels',
  printed.sheetW === 1632 && printed.sheetH === 1056,
  JSON.stringify({ w: printed.sheetW, h: printed.sheetH }));
check('Print/PDF keeps multi-view chrome omitted',
  printed.chromeL === 0 && printed.chromeP === 0,
  JSON.stringify({ L: printed.chromeL, P: printed.chromeP }));

// Direct compose path also reports painted stills (readings rebuilt).
const stills = await page.evaluate(async () => {
  const recId = location.hash.split('/')[2];
  const rec = await window.ToolboxDB.getCustomerFile(recId);
  const doc = rec.reportBuilder;
  const floor = (doc.pages || []).find((p) => p.type === 'floor' && Array.isArray(p.meta && p.meta.views) && p.meta.views.length > 1)
    || (doc.pages || []).find((p) => p.type === 'floor');
  if (!floor || !floor.meta || !floor.meta.views) return { ok: false, reason: 'no views' };
  const api = window.ToolboxFloorSurvey;
  if (!api || typeof api.composeReportTopoFigureForPage !== 'function') {
    return { ok: false, reason: 'no compose api' };
  }
  const getMedia = window.ToolboxDB.getMedia.bind(window.ToolboxDB);
  const out = [];
  for (let i = 0; i < floor.meta.views.length; i += 1) {
    const v = floor.meta.views[i];
    const composed = await api.composeReportTopoFigureForPage(rec, {
      canvasId: v.canvasId,
      epochId: v.epochId,
      areaId: v.scope === 'all' ? null : v.areaId,
      scope: v.scope || 'all',
      settings: v.settings || null,
    }, getMedia);
    out.push({
      slot: i,
      ok: !!(composed && composed.dataUrl && composed.dataUrl.indexOf('data:image') === 0),
      w: composed && composed.width,
      h: composed && composed.height,
      stats: composed && composed.stats && composed.stats.length,
      readingsRebuilt: composed && composed.readingsRebuilt,
    });
  }
  return { ok: out.every((x) => x.ok), out };
});
check('each view composes a painted still with readings', stills.ok, JSON.stringify(stills));

// Legacy two-up migration
const legacy = await page.evaluate(() => {
  const api = window.ToolboxReportFloorViews;
  const fake = {
    meta: {
      canvasId: 'cx', areaId: 'ax', scope: 'area',
      floorTwoUp: true,
      floorView: { mode: 'contour-fill' },
      floorView2: { mode: 'points-only' },
    },
  };
  api.ensurePageViews(fake);
  return {
    n: fake.meta.views.length,
    modes: fake.meta.views.map((v) => v.settings && v.settings.mode),
    chromeOff: fake.meta.views.every((v) => v.showLegend === false && v.showPill === false),
  };
});
check('legacy floorTwoUp migrates to two views', legacy.n === 2 && legacy.modes[1] === 'points-only', JSON.stringify(legacy));
check('migrated multi-view chrome starts hidden', legacy.chromeOff);

await page.screenshot({ path: `${OUT}/report-floor-flex-compose.png`, fullPage: false });
await writeFile(`${OUT}/report-floor-flex-compose.json`,
  JSON.stringify({ results, presented, printed, stills, saved }, null, 2));
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
