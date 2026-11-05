/**
 * Topo rail cleanup: identity above grandparents (multi only); no chrome
 * between nav levels; Accessories Legend/pill write views[] flags.
 * Run: node tests/rb-rail-cleanup.mjs  (static server on 8765)
 */
import { createRequire } from 'module';
import { mkdir } from 'fs/promises';
const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
const FILE = 'rb-rail-cleanup';
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
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.evaluate(async (id) => {
  const c = document.createElement('canvas');
  c.width = 800; c.height = 600;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 800, 600);
  await window.ToolboxDB.putMedia('plan-cleanup', c.toDataURL('image/jpeg', 0.9));
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Rail'; rec.lastName = 'Cleanup';
  rec.propertyAddress = '5 Clean Lane';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Floor Plan';
  cv.plan = { id: 'plan-cleanup', width: 800, height: 600 };
  cv.frontDoorFacing = 'N';
  const poly = [{ x: 40, y: 40 }, { x: 760, y: 40 }, { x: 760, y: 560 }, { x: 40, y: 560 }];
  const points = [];
  for (let i = 1; i <= 6; i++) {
    points.push({ id: 'c' + i, floorId: cv.id, index: i, x: 100 + i * 80, y: 200, value: 5 + i * 0.2 });
  }
  rec.floorSurvey = {
    id: 'fs-clean', inspectionDate: '2026-11-02',
    byCanvasId: {
      [cv.id]: {
        canvasId: cv.id, points,
        areas: [{ id: 'a1', name: 'Floor Plan', polygon: poly, createdAt: 1 }],
        boundary: poly,
      },
    },
  };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 4000));
await page.evaluate(() => {
  const t = [...document.querySelectorAll('.rb-thumb[data-page-id^="floor-"]')]
    .find((el) => !/reserved/i.test(el.getAttribute('data-page-id') || ''))
    || [...document.querySelectorAll('.rb-thumb[data-page-id^="floor-"]')][0];
  t?.click();
});
await page.waitForFunction(
  () => !!document.querySelector('[data-rb-floor-import]') || !!document.querySelector('[data-rb-floor-task]'),
  { timeout: 25000 },
);
if (await page.evaluate(() => { const b = document.querySelector('[data-rb-floor-import]'); if (b) { b.click(); return true; } return false; })) {
  await page.waitForFunction(() => !!document.querySelector('[data-rb-floor-task]'), { timeout: 30000 });
}
await new Promise((r) => setTimeout(r, 1500));
await page.evaluate(() => document.querySelector('[data-rb-floor-task="topo"]')?.click());
await page.waitForFunction(() => document.querySelectorAll('.rb-ws__subtab').length >= 2, { timeout: 15000 });

const single = await page.evaluate(() => ({
  lead: !!document.querySelector('[data-rb-floor-topo-lead]'),
  chrome: document.querySelectorAll('[data-rb-floor-view-chrome]').length,
  applyCopy: /Contours \/ Readings \/ Accessories/.test(document.querySelector('#rb-rail')?.innerText || ''),
  grandparents: [...document.querySelectorAll('[data-rb-floor-task]')].map((b) => b.textContent.trim()),
  parents: [...document.querySelectorAll('.rb-ws__subtab')].map((b) => b.textContent.trim()),
  siblings: [...document.querySelectorAll('[data-fs-cp-section]')].map((b) => b.textContent.trim()),
}));
check('single-view has no identity line or Hide legend/H/L buttons',
  !single.lead && single.chrome === 0 && !single.applyCopy, JSON.stringify(single));
check('single-view nav hierarchy present',
  single.grandparents.join('|') === 'Sheet Layout|Topo'
    && single.parents.join('|') === 'Contours|Readings'
    && single.siblings.join('|') === 'Display|Colors|Lines',
  JSON.stringify(single));
await page.screenshot({ path: `${OUT}/rb-rail-cleanup-single.png`, fullPage: false });

await page.evaluate(() => document.querySelector('[data-rb-floor-task="layout"]')?.click());
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => document.querySelector('[data-rb-floor-view="add"]')?.click());
await page.waitForFunction(
  () => document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) [data-rb-topo-frame]').length >= 2,
  { timeout: 20000 },
);
await new Promise((r) => setTimeout(r, 1000));
await page.evaluate(() => document.querySelector('[data-rb-floor-task="topo"]')?.click());
await new Promise((r) => setTimeout(r, 600));

const multi = await page.evaluate(() => {
  const lead = document.querySelector('[data-rb-floor-topo-lead]');
  const title = [...document.querySelectorAll('#rb-rail *')].find((el) => (el.textContent || '').trim() === 'Floor Survey' && el.children.length === 0)
    || document.querySelector('.rb-ws__title');
  const task = document.querySelector('.rb-ws__task-tabs');
  const parents = document.querySelector('.rb-ws__subtabs');
  const lb = lead?.getBoundingClientRect();
  const tb = title?.getBoundingClientRect();
  const gb = task?.getBoundingClientRect();
  const pb = parents?.getBoundingClientRect();
  return {
    text: (lead?.textContent || '').trim(),
    chrome: document.querySelectorAll('[data-rb-floor-view-chrome]').length,
    applyCopy: /Contours \/ Readings \/ Accessories/.test(document.querySelector('#rb-rail')?.innerText || ''),
    aboveGp: !!(lb && gb && lb.bottom <= gb.top + 2),
    belowTitle: !!(lb && tb && lb.top >= tb.bottom - 4),
    gpThenParents: !!(gb && pb && gb.bottom <= pb.top + 2),
  };
});
check('multi-view compact identity above grandparents',
  /^View \d+ of \d+/.test(multi.text) && multi.chrome === 0 && !multi.applyCopy
    && multi.aboveGp && multi.belowTitle && multi.gpThenParents,
  JSON.stringify(multi));

// Toggle Legend on selected view via Accessories; confirm views[] flag.
await page.evaluate(() => {
  document.querySelector('[data-rb-topo-frame="0"]')
    ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => document.querySelector('[data-rb-topo-group="readings"]')?.click());
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => document.querySelector('[data-fs-cp-section="accessories"]')?.click());
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => {
  const lab = [...document.querySelectorAll('[data-rb-topo-panel] label, .rb-ws__controls label')]
    .find((l) => (l.textContent || '').trim() === 'Legend');
  const sw = lab?.closest('div')?.querySelector('[role=switch]');
  if (sw && (sw.getAttribute('data-state') === 'unchecked' || sw.getAttribute('aria-checked') === 'false')) sw.click();
});
await new Promise((r) => setTimeout(r, 1200));
const afterOn = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const floor = (rec.reportBuilder.pages || []).find((p) => p && p.type === 'floor' && !p.meta?.reserved);
  const views = floor?.meta?.views || [];
  return views.map((v) => ({ L: !!v.showLegend, P: !!v.showPill, sL: !!(v.settings && v.settings.showLegend) }));
}, FILE);
check('Accessories Legend writes selected-view showLegend (view 0)',
  afterOn[0] && afterOn[0].L === true && afterOn[0].sL === true
    && afterOn[1] && afterOn[1].L === false,
  JSON.stringify(afterOn));

await page.evaluate(() => {
  document.querySelector('[data-rb-topo-frame="1"]')
    ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 600));
const id2 = await page.evaluate(() => (document.querySelector('[data-rb-floor-topo-lead]')?.textContent || '').trim());
check('selecting other view updates identity',
  /^View 2 of 2/.test(id2), id2);

await page.screenshot({ path: `${OUT}/rb-rail-cleanup-multi.png`, fullPage: false });
const clip = await page.evaluate(() => {
  const rail = document.querySelector('#rb-rail');
  const r = rail.getBoundingClientRect();
  return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: Math.min(r.width, 360), height: Math.min(480, r.height) };
});
await page.screenshot({ path: `${OUT}/rb-rail-cleanup-multi-closeup.png`, clip });

await page.setViewport({ width: 980, height: 900, deviceScaleFactor: 1 });
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: `${OUT}/rb-rail-cleanup-narrow.png`, fullPage: false });

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
await browser.close();
if (failed) process.exit(1);
