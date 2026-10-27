/**
 * GPT-036 — Floor Survey report sidebar Sheet Layout | Topo task tabs.
 * Run: node tests/report-floor-task-tabs.mjs  (static server on 8765)
 */
import { createRequire } from 'module';
import { mkdir, writeFile } from 'fs/promises';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
const FILE = 'rb-task-tabs';
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

async function openTask(which) {
  await page.evaluate((w) => document.querySelector(`[data-rb-floor-task="${w}"]`)?.click(), which);
  await new Promise((r) => setTimeout(r, 500));
}

await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.evaluate(async (id) => {
  const c = document.createElement('canvas');
  c.width = 800; c.height = 600;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 800, 600);
  x.strokeStyle = '#111'; x.strokeRect(20, 20, 760, 560);
  await window.ToolboxDB.putMedia('plan-tabs', c.toDataURL('image/jpeg', 0.9));
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Tabs'; rec.lastName = 'Probe';
  rec.propertyAddress = '1 Tab Lane';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Main Level';
  cv.plan = { id: 'plan-tabs', width: 800, height: 600 };
  cv.frontDoorFacing = 'N';
  const poly = [{ x: 40, y: 40 }, { x: 760, y: 40 }, { x: 760, y: 560 }, { x: 40, y: 560 }];
  const points = [];
  for (let i = 1; i <= 6; i += 1) {
    points.push({ id: 't' + i, floorId: cv.id, index: i, x: 100 + i * 80, y: 200, value: 5 + i * 0.3 });
  }
  rec.floorSurvey = {
    id: 'fs-tabs', inspectionDate: '2026-10-26',
    byCanvasId: {
      [cv.id]: {
        canvasId: cv.id, points,
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
  { timeout: 25000 });
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
    { timeout: 30000 });
}
await new Promise((r) => setTimeout(r, 2200));

const peer = await page.evaluate(() => ({
  tabs: [...document.querySelectorAll('[data-rb-floor-task]')].map((b) => b.textContent.trim()),
  active: [...document.querySelectorAll('[data-rb-floor-task].is-active')]
    .map((b) => b.getAttribute('data-rb-floor-task')),
  hasAdd: !!document.querySelector('[data-rb-floor-view="add"]'),
  hasTopoHost: !!document.querySelector('.rb-ws__controls'),
  railW: Math.round(document.querySelector('#rb-rail')?.getBoundingClientRect().width || 0),
}));
check('default Sheet Layout shows composition controls only',
  peer.tabs.join('|') === 'Sheet Layout|Topo' && peer.active[0] === 'layout'
    && peer.hasAdd && !peer.hasTopoHost,
  JSON.stringify(peer));

const beforeGeom = await page.evaluate(() => {
  const frame = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-topo-frame]');
  const r = frame?.getBoundingClientRect();
  return r ? { x: +r.left.toFixed(1), y: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) } : null;
});
await openTask('topo');
const topo = await page.evaluate(() => ({
  active: document.querySelector('[data-rb-floor-task].is-active')?.getAttribute('data-rb-floor-task'),
  hasAdd: !!document.querySelector('[data-rb-floor-view="add"]'),
  hasTopoHost: !!document.querySelector('.rb-ws__controls'),
  subTabs: [...document.querySelectorAll('[data-rb-rail-tab]')].map((b) => b.textContent.trim()),
  subTabClasses: [...document.querySelectorAll('[data-rb-rail-tab]')].map((b) => b.className),
  hasSubNav: !!document.querySelector('.rb-ws__sub-tabs'),
  hasAccordionChevron: !!document.querySelector('.rb-ws__controls [data-rb-rail-tab] svg'),
  activeSub: document.querySelector('[data-rb-rail-tab][aria-selected="true"]')?.getAttribute('data-rb-rail-tab'),
  railW: Math.round(document.querySelector('#rb-rail')?.getBoundingClientRect().width || 0),
  overflowX: document.querySelector('#rb-rail')
    ? document.querySelector('#rb-rail').scrollWidth > document.querySelector('#rb-rail').clientWidth + 1
    : true,
}));
const afterGeom = await page.evaluate(() => {
  const frame = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-topo-frame]');
  const r = frame?.getBoundingClientRect();
  return r ? { x: +r.left.toFixed(1), y: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) } : null;
});
check('Topo tab shows Contours/Readings/Legend Excel sub-tabs, hides layout controls',
  topo.active === 'topo' && !topo.hasAdd && topo.hasTopoHost && topo.hasSubNav
    && topo.subTabs.join('|') === 'Contours|Readings|Legend & H/L'
    && topo.subTabClasses.every((c) => /\brb-ws__sub-tab\b/.test(c))
    && !topo.hasAccordionChevron && !topo.overflowX,
  JSON.stringify(topo));
check('switching task tabs does not move sheet geometry',
  beforeGeom && afterGeom
    && beforeGeom.x === afterGeom.x && beforeGeom.y === afterGeom.y
    && beforeGeom.w === afterGeom.w && beforeGeom.h === afterGeom.h
    && peer.railW === topo.railW,
  JSON.stringify({ beforeGeom, afterGeom, railW: peer.railW }));

await page.screenshot({ path: `${OUT}/rb-task-tabs-topo-1440.png`, fullPage: false });

await openTask('layout');
await page.evaluate(() => document.querySelector('[data-rb-floor-view="add"]')?.click());
await page.waitForFunction(
  () => document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) [data-rb-topo-frame]').length >= 2,
  { timeout: 20000 });
await new Promise((r) => setTimeout(r, 1200));

await page.evaluate(() => {
  document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-topo-frame="0"]')
    ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 500));
await openTask('topo');
await page.evaluate(() => document.querySelector('[data-rb-rail-tab="contours"]')?.click());
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => {
  const sel = [...document.querySelectorAll('.rb-ws__controls select')]
    .find((s) => [...s.options].some((o) => o.value === 'points-only'));
  if (!sel) return;
  sel.value = 'contour-bw';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 1000));

await page.evaluate(() => {
  document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-topo-frame="1"]')
    ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 600));
const stillTopo = await page.evaluate(() =>
  document.querySelector('[data-rb-floor-task].is-active')?.getAttribute('data-rb-floor-task'));
check('selecting another view keeps Topo task tab', stillTopo === 'topo', `tab=${stillTopo}`);

await page.evaluate(() => document.querySelector('[data-rb-rail-tab="contours"]')?.click());
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => {
  const sel = [...document.querySelectorAll('.rb-ws__controls select')]
    .find((s) => [...s.options].some((o) => o.value === 'points-only'));
  if (!sel) return;
  sel.value = 'points-only';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 1200));

const modes = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const floor = (rec.reportBuilder.pages || []).find((p) => p && p.type === 'floor' && !p.meta?.reserved);
  const views = floor?.meta?.views || [];
  return views.map((v) => (v.settings && v.settings.mode) || v.mode || null);
}, FILE);
check('per-view Contours Mode changes only the intended view',
  modes[0] === 'contour-bw' && modes[1] === 'points-only',
  JSON.stringify(modes));

await openTask('topo');
await page.evaluate(() => document.querySelector('[data-rb-rail-tab="legendhl"]')?.click());
await new Promise((r) => setTimeout(r, 400));
const legendState = await page.evaluate(() => {
  const lab = [...document.querySelectorAll('.rb-ws__controls label')]
    .find((l) => (l.textContent || '').trim() === 'Legend');
  const sw = lab?.closest('div.flex')?.querySelector('[role=switch]');
  return {
    switch: sw ? (sw.getAttribute('data-state') || sw.getAttribute('aria-checked')) : null,
    showBtn: !!document.querySelector('[data-rb-floor-view-chrome="legend-on"]'),
  };
});
check('Legend & H/L sub-tab shows selected-view chrome for multi-view',
  legendState.showBtn && (legendState.switch === 'unchecked' || legendState.switch === 'false'),
  JSON.stringify(legendState));

// Secondary Excel folder-tab geometry: rounded top, flat bottom, active joins panel.
const folderGeom = await page.evaluate(() => {
  const primary = document.querySelector('[data-rb-floor-task="topo"]');
  const sub = document.querySelector('[data-rb-rail-tab].is-active') ||
    document.querySelector('[data-rb-rail-tab][aria-selected="true"]');
  const inactiveSub = document.querySelector('[data-rb-rail-tab]:not(.is-active)');
  const idleLayout = document.querySelector('[data-rb-floor-task="layout"]:not(.is-active)');
  const cs = (el) => el ? getComputedStyle(el) : null;
  const p = cs(primary);
  const s = cs(sub);
  const i = cs(inactiveSub);
  const layoutIdle = cs(idleLayout);
  const navy = 'rgb(7, 40, 61)';
  const softNavy = 'rgb(61, 95, 115)';
  const muted = 'rgb(90, 115, 130)';
  const primaryGray = 'rgb(229, 235, 238)';
  return {
    primaryRadius: p && [p.borderTopLeftRadius, p.borderTopRightRadius, p.borderBottomLeftRadius, p.borderBottomRightRadius],
    subRadius: s && [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomLeftRadius, s.borderBottomRightRadius],
    primaryBg: p && p.backgroundColor,
    primaryColor: p && p.color,
    primaryWeight: p && p.fontWeight,
    subBg: s && s.backgroundColor,
    subColor: s && s.color,
    subWeight: s && s.fontWeight,
    inactiveSubBg: i && i.backgroundColor,
    inactiveSubColor: i && i.color,
    inactiveSubWeight: i && i.fontWeight,
    layoutIdleBg: layoutIdle && layoutIdle.backgroundColor,
    subBottomBorder: s && s.borderBottomColor,
    subMinH: s && parseFloat(s.minHeight),
    primaryMinH: p && parseFloat(p.minHeight),
    navy,
    softNavy,
    muted,
    primaryGray,
  };
});
check('secondary tabs use same Excel folder construction, compact vs primary',
  folderGeom.subRadius &&
    folderGeom.subRadius[0] !== '0px' && folderGeom.subRadius[1] !== '0px' &&
    folderGeom.subRadius[2] === '0px' && folderGeom.subRadius[3] === '0px' &&
    folderGeom.primaryRadius && folderGeom.primaryRadius[2] === '0px' &&
    folderGeom.subMinH > 0 && folderGeom.primaryMinH > 0 &&
    folderGeom.subMinH < folderGeom.primaryMinH,
  JSON.stringify(folderGeom));
check('hybrid: idle primary is gray; secondary idle stays white',
  folderGeom.primaryBg === folderGeom.navy && folderGeom.primaryColor === 'rgb(255, 255, 255)' &&
    Number(folderGeom.primaryWeight) >= 600 &&
    folderGeom.subBg === folderGeom.softNavy && folderGeom.subColor === 'rgb(255, 255, 255)' &&
    folderGeom.subBg !== folderGeom.primaryBg &&
    folderGeom.layoutIdleBg === folderGeom.primaryGray &&
    folderGeom.inactiveSubBg === 'rgb(255, 255, 255)' && folderGeom.inactiveSubColor === folderGeom.muted &&
    Number(folderGeom.inactiveSubWeight) <= 500 &&
    folderGeom.subBottomBorder === 'rgb(255, 255, 255)',
  JSON.stringify(folderGeom));

// When Sheet Layout is selected, idle Topo must be gray (primary row only).
await openTask('layout');
const layoutSel = await page.evaluate(() => {
  const layout = document.querySelector('[data-rb-floor-task="layout"].is-active');
  const topo = document.querySelector('[data-rb-floor-task="topo"]:not(.is-active)');
  const cs = (el) => el ? getComputedStyle(el) : null;
  return {
    layoutBg: cs(layout)?.backgroundColor,
    topoBg: cs(topo)?.backgroundColor,
    hasSub: !!document.querySelector('.rb-ws__sub-tab'),
  };
});
check('Sheet Layout selected → Topo idle is gray; no secondary row',
  layoutSel.layoutBg === 'rgb(7, 40, 61)' &&
    layoutSel.topoBg === 'rgb(229, 235, 238)' &&
    !layoutSel.hasSub,
  JSON.stringify(layoutSel));
await openTask('topo');

await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: `${OUT}/rb-task-tabs-topo-1920.png`, fullPage: false });
await openTask('layout');
await page.screenshot({ path: `${OUT}/rb-task-tabs-layout-1920.png`, fullPage: false });

await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
await writeFile(`${OUT}/rb-task-tabs.json`, JSON.stringify({ passed, total: results.length, results }, null, 2));
if (passed < results.length) process.exit(1);
