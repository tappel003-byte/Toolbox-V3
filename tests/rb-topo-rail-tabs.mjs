/**
 * Report Builder topo rail matches Floor Survey Control panel parents:
 * Contours | Readings. Child Show/Format/Accessories live inside Readings.
 *
 * Run: node tests/rb-topo-rail-tabs.mjs  (static server on 8765)
 */
import { createRequire } from 'module';
import { mkdir } from 'fs/promises';
const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
const FILE = 'rb-rail-tabs';
await mkdir(OUT, { recursive: true });
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
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

await page.evaluate(async (id) => {
  const c = document.createElement('canvas');
  c.width = 800; c.height = 600;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 800, 600);
  x.strokeStyle = '#111'; x.strokeRect(20, 20, 760, 560);
  await window.ToolboxDB.putMedia('plan-rail', c.toDataURL('image/jpeg', 0.9));
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Rail'; rec.lastName = 'Tabs';
  rec.propertyAddress = '1 Rail Lane';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Main Level';
  cv.plan = { id: 'plan-rail', width: 800, height: 600 };
  cv.frontDoorFacing = 'N';
  const poly = [{ x: 40, y: 40 }, { x: 760, y: 40 }, { x: 760, y: 560 }, { x: 40, y: 560 }];
  rec.floorSurvey = {
    id: 'fs-rail', inspectionDate: '2026-10-31',
    byCanvasId: {
      [cv.id]: {
        canvasId: cv.id,
        points: [
          { id: 'hi', floorId: cv.id, index: 1, x: 500, y: 180, value: 3.3 },
          { id: 'lo', floorId: cv.id, index: 2, x: 200, y: 420, value: 1.1 },
          { id: 'mid', floorId: cv.id, index: 3, x: 350, y: 300, value: 2.2 },
        ],
        areas: [{ id: 'a1', name: 'Main Level', polygon: poly, createdAt: 1 }],
        boundary: poly,
      },
    },
  };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 5000));
await page.evaluate(() => {
  const t = [...document.querySelectorAll('.rb-thumb[data-page-id^="floor-"]')]
    .find((el) => !/reserved/i.test(el.getAttribute('data-page-id') || ''))
    || [...document.querySelectorAll('.rb-thumb[data-page-id^="floor-"]')][0];
  t?.click();
});
await page.waitForFunction(
  () => !!document.querySelector('[data-rb-floor-import]') ||
    !!document.querySelector('[data-rb-floor-box^="topo"]') ||
    !!document.querySelector('[data-rb-floor-task]'),
  { timeout: 25000 },
);
const needsImport = await page.evaluate(() => {
  const btn = document.querySelector('[data-rb-floor-import]');
  if (!btn) return false;
  btn.click();
  return true;
});
if (needsImport) {
  await page.waitForFunction(
    () => !!document.querySelector('[data-rb-floor-box^="topo"]') ||
      !!document.querySelector('[data-rb-floor-task]'),
    { timeout: 30000 },
  );
}
await new Promise((r) => setTimeout(r, 2200));

await page.evaluate(() => document.querySelector('[data-rb-floor-task="topo"]')?.click());
await new Promise((r) => setTimeout(r, 800));
await page.waitForFunction(
  () => !!document.querySelector('[data-rb-topo-group]'),
  { timeout: 15000 },
);

const railTabs = await page.evaluate(() =>
  [...document.querySelectorAll('[data-rb-topo-group]')].map((b) => ({
    id: b.getAttribute('data-rb-topo-group'),
    label: (b.textContent || '').trim(),
  })),
);
check(
  'Rail parents are Contours | Readings only',
  railTabs.length === 2 &&
    railTabs.map((t) => t.id).join('|') === 'contours|readings',
  JSON.stringify(railTabs),
);

await page.evaluate(() => document.querySelector('[data-rb-topo-group="readings"]')?.click());
await new Promise((r) => setTimeout(r, 700));

const readingsKids = await page.evaluate(() => {
  const panel = document.querySelector('#rb-topo-group-panel');
  const sectionTabs = [...(panel?.querySelectorAll('[role="tab"]') || [])].map((b) =>
    (b.textContent || '').trim(),
  );
  return {
    panelId: panel?.getAttribute('data-rb-topo-panel'),
    sectionTabs,
    hasSeat: !!panel?.querySelector('[aria-label="Point label side"]'),
    hasGap: !!panel?.querySelector('[aria-label="Label gap"]'),
  };
});
check(
  'Readings opens Show|Format|Accessories with seats + gap',
  readingsKids.panelId === 'readings' &&
    readingsKids.sectionTabs.includes('Show') &&
    readingsKids.sectionTabs.includes('Format') &&
    readingsKids.sectionTabs.includes('Accessories') &&
    readingsKids.hasSeat &&
    readingsKids.hasGap,
  JSON.stringify(readingsKids),
);

await page.evaluate(() => {
  const panel = document.querySelector('#rb-topo-group-panel');
  [...(panel?.querySelectorAll('[role="tab"]') || [])]
    .find((b) => (b.textContent || '').trim() === 'Accessories')
    ?.click();
});
await new Promise((r) => setTimeout(r, 400));

const accessories = await page.evaluate(() => {
  const text = document.querySelector('#rb-topo-group-panel')?.innerText || '';
  return {
    hld: /H\/L\/Δ size/.test(text),
    pin: /High\/Low size/.test(text),
    toggle: /High \/ low/.test(text),
  };
});
check(
  'Readings → Accessories has H/L sizes',
  accessories.hld && accessories.pin && accessories.toggle,
  JSON.stringify(accessories),
);

await page.evaluate(() => document.querySelector('[data-rb-topo-group="contours"]')?.click());
await new Promise((r) => setTimeout(r, 600));

const contoursKids = await page.evaluate(() => {
  const panel = document.querySelector('#rb-topo-group-panel');
  const sectionTabs = [...(panel?.querySelectorAll('[role="tab"]') || [])].map((b) =>
    (b.textContent || '').trim(),
  );
  const text = panel?.innerText || '';
  return {
    panelId: panel?.getAttribute('data-rb-topo-panel'),
    sectionTabs,
    hasMode: /Mode/.test(text),
    hasLegend: /Legend/.test(text),
  };
});
check(
  'Contours opens Display|Colors|Lines with Legend under Display',
  contoursKids.panelId === 'contours' &&
    contoursKids.sectionTabs.includes('Display') &&
    contoursKids.sectionTabs.includes('Colors') &&
    contoursKids.sectionTabs.includes('Lines') &&
    contoursKids.hasMode &&
    contoursKids.hasLegend,
  JSON.stringify(contoursKids),
);

const hierarchy = await page.evaluate(() => {
  const rail = document.querySelector('#rb-rail')?.getBoundingClientRect();
  const gp = [...document.querySelectorAll('.rb-ws__task-tab')].map((b) => {
    const r = b.getBoundingClientRect();
    const cs = getComputedStyle(b);
    return {
      t: (b.textContent || '').trim(),
      w: Math.round(r.width),
      h: Math.round(r.height),
      left: Math.round(r.left),
      bg: cs.backgroundColor,
      on: b.classList.contains('is-active'),
    };
  });
  const parents = [...document.querySelectorAll('.rb-ws__subtab')].map((b) => {
    const r = b.getBoundingClientRect();
    const cs = getComputedStyle(b);
    return {
      t: (b.textContent || '').trim(),
      w: Math.round(r.width),
      h: Math.round(r.height),
      left: Math.round(r.left),
      bg: cs.backgroundColor,
      on: b.classList.contains('is-active'),
    };
  });
  const panel = document.querySelector('#rb-topo-group-panel');
  const sibs = [...(panel?.querySelectorAll('[role="tab"]') || [])].map((b) => {
    const r = b.getBoundingClientRect();
    return {
      t: (b.textContent || '').trim(),
      h: Math.round(r.height),
      on: b.getAttribute('aria-selected') === 'true',
    };
  });
  const gpRow = document.querySelector('.rb-ws__task-tabs')?.getBoundingClientRect();
  const parentRow = document.querySelector('.rb-ws__subtabs')?.getBoundingClientRect();
  const gap = gpRow && parentRow ? Math.round(parentRow.top - gpRow.bottom) : null;
  const gpSpan = gp.length === 2 ? Math.round(gp[1].left + gp[1].w - gp[0].left) : 0;
  const railInner = rail ? Math.round(rail.width) : 0;
  return { gp, parents, sibs, gap, gpSpan, railInner };
});
const parentH = Math.min(...hierarchy.parents.map((p) => p.h));
const sibH = Math.min(...hierarchy.sibs.map((s) => s.h));
const gpH = Math.min(...hierarchy.gp.map((g) => g.h));
const inactiveGp = hierarchy.gp.find((g) => !g.on);
const inactiveParent = hierarchy.parents.find((p) => !p.on);
const looksGray = (bg) => /rgb\(\s*22[89]|rgb\(\s*23[0-9]/.test(bg || '');
check(
  'Hierarchy: full-width grandparents, gap before parents, parents taller than siblings, blue not gray',
  hierarchy.gp.length === 2 &&
    hierarchy.parents.length === 2 &&
    hierarchy.sibs.length >= 2 &&
    hierarchy.gap != null &&
    hierarchy.gap >= 8 &&
    gpH > parentH &&
    parentH > sibH &&
    hierarchy.gpSpan >= hierarchy.railInner - 4 &&
    !looksGray(inactiveGp?.bg) &&
    !looksGray(inactiveParent?.bg),
  JSON.stringify(hierarchy),
);

await page.screenshot({ path: `${OUT}/rb-topo-rail-contours.png` });
const railShot = await page.$('#rb-rail');
if (railShot) await railShot.screenshot({ path: `${OUT}/rb-tab-hierarchy-rail-crop.png` });
await page.evaluate(() => document.querySelector('[data-rb-topo-group="readings"]')?.click());
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: `${OUT}/rb-topo-rail-readings-show.png` });

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
await browser.close();
process.exit(failed ? 1 : 0);
