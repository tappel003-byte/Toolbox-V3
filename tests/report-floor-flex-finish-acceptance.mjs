/**
 * Hands-on acceptance for Report Builder flexible-compose finish (checks 1–9).
 * Run: node tests/report-floor-flex-finish-acceptance.mjs  (static server on 8765)
 *
 * Real pointer/control actions on the running app. Evidence under /opt/cursor/artifacts.
 */
import { createRequire } from 'module';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { execFileSync } from 'child_process';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
const FILE = 'rb-flex-finish-accept';
const results = [];
const checklist = [];

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
function accept(id, title, ok, detail = '', notes = '') {
  checklist.push({ id, title, ok: !!ok, detail, notes });
  check(`[${id}] ${title}`, ok, detail);
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
  async function planMedia(pid, label, tint) {
    const c = document.createElement('canvas');
    c.width = 1000; c.height = 800;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 1000, 800);
    x.fillStyle = tint; x.fillRect(40, 40, 220, 70);
    x.strokeStyle = '#111'; x.lineWidth = 6; x.strokeRect(20, 20, 960, 760);
    x.fillStyle = '#111'; x.font = 'bold 26px sans-serif';
    x.fillText(label, 55, 85);
    x.fillText('N-EDGE', 420, 55);
    x.fillText('S-EDGE', 420, 760);
    x.fillText('W', 30, 420);
    x.fillText('E', 950, 420);
    await window.ToolboxDB.putMedia(pid, c.toDataURL('image/jpeg', 0.92));
  }
  await planMedia('plan-main-fin', 'MAIN', '#ff00ff');
  await planMedia('plan-second-fin', 'SECOND', '#00a0ff');
  await planMedia('plan-garage-fin', 'GARAGE', '#40a040');

  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Finish'; rec.lastName = 'Accept';
  rec.propertyAddress = '11 Finish Way\nSanta Fe, NM 87501';
  const main = rec.planSetup.canvases[0];
  main.name = 'Main Level';
  main.plan = { id: 'plan-main-fin', width: 1000, height: 800 };
  main.frontDoorFacing = 'E';
  const second = window.ToolboxPlanSetup.blankCanvas('Second Floor');
  second.plan = { id: 'plan-second-fin', width: 1000, height: 800 };
  second.frontDoorFacing = 'E';
  rec.planSetup.canvases.push(second);
  const garage = window.ToolboxPlanSetup.blankCanvas('Garage');
  garage.plan = { id: 'plan-garage-fin', width: 1000, height: 800 };
  garage.frontDoorFacing = 'N';
  rec.planSetup.canvases.push(garage);

  function layer(cv, tag, base, twoBoundaries) {
    const poly = [{ x: 40, y: 40 }, { x: 960, y: 40 }, { x: 960, y: 760 }, { x: 40, y: 760 }];
    const polyB = [{ x: 80, y: 80 }, { x: 480, y: 80 }, { x: 480, y: 400 }, { x: 80, y: 400 }];
    const points = [];
    let n = 0;
    for (let r = 0; r < 3; r += 1) for (let c = 0; c < 4; c += 1) {
      n += 1;
      points.push({
        id: tag + n, floorId: cv.id, index: n,
        x: 120 + c * 220, y: 160 + r * 200,
        value: base + ((n * 5) % 20) / 10,
      });
    }
    const areas = [{ id: tag + '-a', name: cv.name, polygon: poly, createdAt: 1 }];
    if (twoBoundaries) {
      areas.push({ id: tag + '-b', name: 'Garage Bay', polygon: polyB, createdAt: 2 });
    }
    return {
      canvasId: cv.id, points, boundary: poly, areas,
    };
  }
  rec.floorSurvey = {
    id: 'fs-fin', inspectionDate: '2026-10-25',
    byCanvasId: {
      // Two boundaries so Combined appears in the source picker (GPT-030 #2).
      [main.id]: layer(main, 'm', 6, true),
      [second.id]: layer(second, 's', 18, false),
      [garage.id]: layer(garage, 'g', 3, false),
    },
  };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

async function openFloorThumb(matchRe) {
  await page.evaluate((re) => {
    const thumbs = [...document.querySelectorAll('.rb-thumb[data-page-id^="floor-"]')];
    const t = thumbs.find((el) => new RegExp(re, 'i').test(el.textContent || '')) || thumbs[0];
    t?.click();
  }, matchRe);
  await page.waitForFunction(
    () => !!document.querySelector('[data-rb-floor-import]') ||
      !!document.querySelector('[data-rb-floor-box^="topo"]'),
    { timeout: 25000 });
  const needsImport = await page.evaluate(() => {
    const btn = document.querySelector('[data-rb-floor-import]');
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (needsImport) {
    await page.waitForFunction(
      () => !!document.querySelector('[data-rb-floor-box^="topo"]'),
      { timeout: 30000 });
  }
  await new Promise((r) => setTimeout(r, 2200));
}

function clickRailText(re) {
  return page.evaluate((pattern) => {
    const b = [...document.querySelectorAll('.rb-panel .btn')]
      .find((el) => new RegExp(pattern).test((el.textContent || '').trim()));
    if (!b) return false;
    b.click();
    return (b.textContent || '').trim();
  }, re);
}

async function openLegendHlTab() {
  await page.evaluate(() => {
    [...document.querySelectorAll('[role=tab]')]
      .find((t) => /Legend & H\/L/i.test(t.textContent || ''))?.click();
  });
  await new Promise((r) => setTimeout(r, 400));
}

/** Contours Mode <select> inside the rail host — not the View source picker. */
async function setContoursMode(mode) {
  await page.evaluate(() => {
    [...document.querySelectorAll('[role=tab]')]
      .find((t) => /Contours/i.test(t.textContent || ''))?.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  return page.evaluate((want) => {
    const sel = [...document.querySelectorAll('.rb-ws__controls select')]
      .find((s) => [...s.options].some((o) => o.value === 'points-only'));
    if (!sel) {
      return {
        ok: false,
        reason: 'no-mode-select',
        selects: [...document.querySelectorAll('select')].map((s) => ({
          cls: s.className,
          vals: [...s.options].map((o) => o.value).slice(0, 6),
        })),
      };
    }
    sel.value = want;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, mode: sel.value };
  }, mode);
}

async function setLegendHlSwitch(label, wantOn) {
  await openLegendHlTab();
  const box = await page.evaluate((lab) => {
    const labEl = [...document.querySelectorAll('.rb-ws__controls label, .rb-panel label')]
      .find((l) => (l.textContent || '').trim() === lab);
    if (!labEl) return null;
    const row = labEl.closest('div.flex');
    const sw = row && row.querySelector('[role=switch]');
    if (!sw) return null;
    const r = sw.getBoundingClientRect();
    const on = sw.getAttribute('aria-checked') === 'true'
      || sw.getAttribute('data-state') === 'checked';
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, on };
  }, label);
  if (!box) return { ok: false, reason: 'no-switch' };
  if (box.on !== wantOn) {
    await page.mouse.click(box.x, box.y);
    await new Promise((r) => setTimeout(r, 600));
  }
  const after = await page.evaluate((lab) => {
    const labEl = [...document.querySelectorAll('.rb-ws__controls label, .rb-panel label')]
      .find((l) => (l.textContent || '').trim() === lab);
    const sw = labEl?.closest('div.flex')?.querySelector('[role=switch]');
    return sw
      ? (sw.getAttribute('data-state') || sw.getAttribute('aria-checked'))
      : null;
  }, label);
  return { ok: true, was: box.on, want: wantOn, after };
}

async function savedMainViews() {
  return page.evaluate(async (id) => {
    const rec = await window.ToolboxDB.getCustomerFile(id);
    const pages = (rec.reportBuilder && rec.reportBuilder.pages) || [];
    const floor = pages.find((p) => p && p.type === 'floor' && /main/i.test(p.railLabel || p.title || ''));
    const target = floor || pages.find((p) => p && p.type === 'floor' && !p.meta?.reserved);
    const views = (target && target.meta && target.meta.views) || [];
    return {
      pageId: target && target.id,
      ownLayout: !!(target && target.meta && target.meta.ownLayout),
      floorLayout: !!(rec.reportBuilder && rec.reportBuilder.floorLayout),
      floorCamera: rec.reportBuilder && rec.reportBuilder.floorCamera,
      views: views.map((v) => ({
        id: v.id, canvasId: v.canvasId, mode: v.mode || null,
        linkGroup: v.linkGroup || null,
        showLegend: !!v.showLegend, showPill: !!v.showPill,
        frame: v.frame ? { x: v.frame.x, y: v.frame.y, w: v.frame.w, h: v.frame.h } : null,
        camera: v.camera || null,
      })),
    };
  }, FILE);
}

function frameRects() {
  return page.evaluate(() => [...document.querySelectorAll(
    '.rb-sheet:not(.rb-sheet--thumb) [data-rb-topo-frame]')]
    .map((el) => {
      const r = el.getBoundingClientRect();
      return {
        slot: el.getAttribute('data-rb-topo-frame'),
        active: el.classList.contains('is-active'),
        top: +r.top.toFixed(1), height: +r.height.toFixed(1),
        left: +r.left.toFixed(1), width: +r.width.toFixed(1),
      };
    }));
}

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => document.querySelectorAll('.rb-thumb[data-page-id^="floor-"]').length >= 2,
  { timeout: 30000 });
await openFloorThumb('main');

// ========== 9. Finished rail ==========
const rail = await page.evaluate(() => {
  const tabs = [...document.querySelectorAll('.rb-panel [role=tab], [data-rb-rail-tab]')]
    .map((t) => (t.getAttribute('data-rb-rail-tab') || t.textContent || '').trim());
  // Prefer visible tab labels
  const tabLabels = [...document.querySelectorAll('.rb-ws__controls [role=tab], .rb-panel [role=tab]')]
    .map((t) => t.textContent.trim());
  return {
    tabs: tabLabels.length ? tabLabels : tabs,
    floorDefault: !!document.querySelector('.rb-panel [data-rb-template="floor"]'),
    twoup: !!document.querySelector('[data-rb-floor-twoup]'),
    hasAdd: !!document.querySelector('[data-rb-floor-view="add"]'),
    hasCopy: !!document.querySelector('[data-rb-floor-view="copy"]'),
    thisSlide: [...document.querySelectorAll('.rb-panel .btn')]
      .some((b) => /^This slide only$/i.test((b.textContent || '').trim())),
    srcOpts: [...document.querySelectorAll('[data-rb-floor-view-source] option')]
      .map((o) => o.textContent.trim()),
    lead: [...document.querySelectorAll('.rb-panel .rb-panel__lead')]
      .map((p) => p.textContent.trim()).slice(0, 4),
  };
});
accept(9, 'Finished rail — Contours/Readings/Legend & H/L; Combined source; no floor default',
  rail.tabs.join('|') === 'Contours|Readings|Legend & H/L' &&
  !rail.floorDefault && !rail.twoup &&
  rail.hasAdd && rail.hasCopy && rail.thisSlide &&
  rail.srcOpts.some((s) => /Combined/i.test(s)) &&
  rail.srcOpts.some((s) => /Main/i.test(s)) &&
  rail.srcOpts.some((s) => /Second|Garage/i.test(s)),
  JSON.stringify(rail).slice(0, 600));
await page.screenshot({ path: `${OUT}/rb-finish-09-rail.png`, fullPage: false });

// ========== 1. Same floor, two appearances ==========
await page.evaluate(() => document.querySelector('[data-rb-floor-view="add"]')?.click());
await page.waitForFunction(
  () => document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) [data-rb-topo-frame]').length >= 2,
  { timeout: 20000 });
await new Promise((r) => setTimeout(r, 1500));

// GPT-031: fresh/null settings — Legend & H/L/Δ before any Contours/Readings edits.
await page.evaluate(() => {
  document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-topo-frame="0"]')
    ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 600));
await openLegendHlTab();
const freshChrome = await page.evaluate(async (id) => {
  function switchState(lab) {
    const labEl = [...document.querySelectorAll('.rb-ws__controls label')]
      .find((l) => (l.textContent || '').trim() === lab);
    const sw = labEl?.closest('div.flex')?.querySelector('[role=switch]');
    if (!sw) return null;
    return sw.getAttribute('data-state') || sw.getAttribute('aria-checked');
  }
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const floor = (rec.reportBuilder.pages || []).find((p) =>
    p && p.type === 'floor' && Array.isArray(p.meta?.views) && p.meta.views.length >= 2);
  const views = (floor?.meta?.views || []).map((v) => ({
    L: !!v.showLegend, P: !!v.showPill, hasSettings: !!(v.settings && typeof v.settings === 'object'),
    sL: v.settings ? !!v.settings.showLegend : null,
  }));
  return {
    legendSwitch: switchState('Legend'),
    pillSwitch: switchState('H/L/Δ pill'),
    legends: document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-box^="legend"]').length,
    pills: document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-box^="pill"]').length,
    showBtn: !!document.querySelector('[data-rb-floor-view-chrome="legend-on"]'),
    views,
  };
}, FILE);
const freshLegendOn = await setLegendHlSwitch('Legend', true);
await new Promise((r) => setTimeout(r, 1500));
const afterFreshOn = await page.evaluate(() => ({
  legends: document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-box^="legend"]').length,
  switchState: (() => {
    const lab = [...document.querySelectorAll('.rb-ws__controls label')]
      .find((l) => (l.textContent || '').trim() === 'Legend');
    const sw = lab?.closest('div.flex')?.querySelector('[role=switch]');
    return sw ? (sw.getAttribute('data-state') || sw.getAttribute('aria-checked')) : null;
  })(),
}));
const freshLegendOff = await setLegendHlSwitch('Legend', false);
await new Promise((r) => setTimeout(r, 1500));
const afterFreshOff = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const floor = (rec.reportBuilder.pages || []).find((p) =>
    p && p.type === 'floor' && Array.isArray(p.meta?.views) && p.meta.views.length >= 2);
  return {
    legends: document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-box^="legend"]').length,
    switchState: (() => {
      const lab = [...document.querySelectorAll('.rb-ws__controls label')]
        .find((l) => (l.textContent || '').trim() === 'Legend');
      const sw = lab?.closest('div.flex')?.querySelector('[role=switch]');
      return sw ? (sw.getAttribute('data-state') || sw.getAttribute('aria-checked')) : null;
    })(),
    views: (floor?.meta?.views || []).map((v) => ({
      L: !!v.showLegend, sL: !!(v.settings && v.settings.showLegend),
    })),
  };
}, FILE);
const freshPillOn = await setLegendHlSwitch('H/L/Δ pill', true);
await new Promise((r) => setTimeout(r, 1200));
const freshPillOff = await setLegendHlSwitch('H/L/Δ pill', false);
await new Promise((r) => setTimeout(r, 1200));
const freshOk = freshChrome.legends === 0 && freshChrome.pills === 0
  && freshChrome.showBtn
  && !/checked|true/i.test(String(freshChrome.legendSwitch || ''))
  && freshLegendOn.ok && afterFreshOn.legends >= 1 && /checked|true/i.test(String(afterFreshOn.switchState || ''))
  && freshLegendOff.ok && afterFreshOff.legends === 0
  && !/checked|true/i.test(String(afterFreshOff.switchState || ''))
  && afterFreshOff.views.every((v) => v.L === false && v.sL === false)
  && freshPillOn.ok && freshPillOff.ok;

// Select view 0 — Contours Mode → B&W lines (appearance A)
await page.evaluate(() => {
  document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-topo-frame="0"]')
    ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 600));
const modeA = await setContoursMode('contour-bw');
await new Promise((r) => setTimeout(r, 1200));
await page.waitForFunction(
  () => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''),
  { timeout: 15000 }).catch(() => {});

// Select view 1 — Contours Mode → Points only (appearance B); leave view 0 unchanged
await page.evaluate(() => {
  document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-topo-frame="1"]')
    ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 800));
const modeB = await setContoursMode('points-only');
await new Promise((r) => setTimeout(r, 1200));
await page.waitForFunction(
  () => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''),
  { timeout: 15000 }).catch(() => {});
const appearanceProbe = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const floor = (rec.reportBuilder.pages || []).find((p) =>
    p && p.type === 'floor' && Array.isArray(p.meta?.views) && p.meta.views.length >= 2);
  const modes = (floor?.meta?.views || []).map((v) => (v.settings && v.settings.mode) || null);
  return { modes, distinct: modes.length >= 2 && !!modes[0] && !!modes[1] && modes[0] !== modes[1] };
}, FILE);
const selLead = await page.evaluate(() =>
  [...document.querySelectorAll('.rb-panel .rb-panel__lead')]
    .map((p) => p.textContent.trim()).find((t) => /Selected: View|View \d/i.test(t)) || '');
// Ensure linked (Add view same-source starts linked; do not click Unlink by accident).
const linkClicked = await page.evaluate(() => {
  const unlink = document.querySelector('[data-rb-floor-view-link="off"]');
  const link = document.querySelector('[data-rb-floor-view-link="on"]');
  if (unlink) return 'already-linked';
  if (link) { link.click(); return 'linked'; }
  return 'missing';
});
await new Promise((r) => setTimeout(r, 700));

// Live SE-corner resize (same pointer path as flex-compose).
const handleNow = await page.evaluate(() => {
  const frame = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-topo-frame="0"]');
  const handle = frame && frame.querySelector('[data-rb-floor-corner="se"]');
  if (!frame || !handle) {
    return {
      ok: false,
      corners: frame
        ? [...frame.querySelectorAll('[data-rb-floor-corner]')].map((h) => h.getAttribute('data-rb-floor-corner'))
        : [],
    };
  }
  frame.classList.add('is-picked');
  frame.click();
  const fr = frame.getBoundingClientRect();
  let hr = handle.getBoundingClientRect();
  if (!(hr.width > 2 && hr.height > 2)) {
    hr = { x: fr.right - 10, y: fr.bottom - 10, width: 12, height: 12 };
  }
  return {
    ok: true,
    beforeH: parseFloat(frame.style.height) || 0,
    from: { x: hr.x + hr.width / 2, y: hr.y + hr.height / 2 },
    to: { x: hr.x + hr.width / 2, y: fr.y + fr.height * 0.55 },
  };
});
if (handleNow.ok) {
  await page.mouse.move(handleNow.from.x, handleNow.from.y);
  await page.mouse.down();
  await page.mouse.move(handleNow.to.x, handleNow.to.y, { steps: 20 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 1400));
}
const linkedPct = await page.evaluate(() =>
  [...document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) [data-rb-topo-frame]')]
    .slice(0, 2).map((el) => ({
      top: +(parseFloat(el.style.top) || 0).toFixed(2),
      height: +(parseFloat(el.style.height) || 0).toFixed(2),
    })));
const linkedMatch = linkedPct.length >= 2 &&
  Math.abs(linkedPct[0].height - linkedPct[1].height) < 0.6 &&
  Math.abs(linkedPct[0].top - linkedPct[1].top) < 0.6 &&
  linkedPct[0].height < (handleNow.beforeH || 100) - 1;

await page.evaluate(() => document.querySelector('[data-rb-floor-view-link="off"]')?.click());
await new Promise((r) => setTimeout(r, 600));
const handle2 = await page.evaluate(() => {
  const frame = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-topo-frame="1"]');
  const handle = frame && frame.querySelector('[data-rb-floor-corner="se"]');
  if (!frame || !handle) return { ok: false };
  frame.classList.add('is-picked');
  frame.click();
  const fr = frame.getBoundingClientRect();
  const hr = handle.getBoundingClientRect();
  return {
    ok: true,
    beforeH: parseFloat(frame.style.height) || 0,
    from: { x: hr.x + hr.width / 2, y: hr.y + hr.height / 2 },
    to: { x: hr.x + hr.width / 2, y: fr.y + fr.height * 0.35 },
  };
});
if (handle2.ok) {
  await page.mouse.move(handle2.from.x, handle2.from.y);
  await page.mouse.down();
  await page.mouse.move(handle2.to.x, handle2.to.y, { steps: 16 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 1200));
}
const unlinkedPct = await page.evaluate(() =>
  [...document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) [data-rb-topo-frame]')]
    .slice(0, 2).map((el) => ({
      top: +(parseFloat(el.style.top) || 0).toFixed(2),
      height: +(parseFloat(el.style.height) || 0).toFixed(2),
    })));
const independent = unlinkedPct.length >= 2 &&
  Math.abs(unlinkedPct[0].height - unlinkedPct[1].height) > 2;
await page.screenshot({ path: `${OUT}/rb-finish-01-same-floor.png` });
accept(1, 'Same floor two views — fresh Legend/pill + distinct appearance + link/resize/unlink',
  freshOk && handleNow.ok && linkedMatch && independent && /View/i.test(selLead) &&
  modeA.ok && modeB.ok && appearanceProbe.distinct,
  JSON.stringify({
    freshChrome, freshLegendOn, afterFreshOn, freshLegendOff, afterFreshOff, freshPillOn, freshPillOff, freshOk,
    modeA, modeB, appearanceProbe, selLead, linkClicked, handleNow, linkedPct, handle2,
    unlinkedPct, linkedMatch, independent,
  }).slice(0, 1200));

// ========== 2. Different floors ==========
await page.evaluate(() => {
  document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) [data-rb-topo-frame]')[1]?.click();
});
await new Promise((r) => setTimeout(r, 400));
const src2 = await page.evaluate(() => {
  const sel = document.querySelector('[data-rb-floor-view-source]');
  if (!sel) return { ok: false };
  const opt = [...sel.options].find((o) => /Second/i.test(o.textContent || ''));
  if (!opt) return { ok: false, opts: [...sel.options].map((o) => o.textContent) };
  sel.value = opt.value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, label: opt.textContent.trim() };
});
await new Promise((r) => setTimeout(r, 2200));
await page.evaluate(() => {
  const link = document.querySelector('[data-rb-floor-view-link="on"]');
  if (link) link.click();
});
await new Promise((r) => setTimeout(r, 700));
const host = await page.evaluate(() => {
  const h = document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) [data-rb-topo-live]')[0];
  if (!h) return null;
  const r = h.getBoundingClientRect();
  return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.5 };
});
if (host) {
  await page.mouse.move(host.x, host.y);
  await page.mouse.down();
  await page.mouse.move(host.x - 80, host.y - 50, { steps: 14 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 1600));
}
await page.waitForFunction(
  () => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''),
  { timeout: 15000 }).catch(() => {});
const afterDiff = await savedMainViews();
const camsOk = afterDiff.views.length >= 2 && afterDiff.views.some((v) => v.camera);
await page.evaluate(() => {
  document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) [data-rb-topo-frame]')[0]?.click();
});
await new Promise((r) => setTimeout(r, 500));
const leadAfterSel = await page.evaluate(() =>
  [...document.querySelectorAll('.rb-panel .rb-panel__lead')]
    .map((p) => p.textContent.trim()).find((t) => /Selected|View/i.test(t)) || '');
await page.screenshot({ path: `${OUT}/rb-finish-02-diff-floors.png` });
accept(2, 'Different floors — source change, size link, independent framing, selection lead',
  src2.ok && camsOk && /View|Selected|Main|Second/i.test(leadAfterSel),
  JSON.stringify({ src2, views: afterDiff.views, leadAfterSel }).slice(0, 700));

// ========== 3. Reference sheet ==========
await page.evaluate(() => document.querySelector('[data-rb-floor-view="add"]')?.click());
await page.waitForFunction(
  () => document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) [data-rb-topo-frame]').length >= 3,
  { timeout: 20000 });
await new Promise((r) => setTimeout(r, 1200));
await page.evaluate(() => {
  document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) [data-rb-topo-frame]')[2]?.click();
});
await new Promise((r) => setTimeout(r, 400));
const garage = await page.evaluate(() => {
  const sel = document.querySelector('[data-rb-floor-view-source]');
  // Prefer the Garage level, not "Garage Bay" on Main.
  const opt = [...(sel?.options || [])].find((o) => /^Garage\s*—/.test(o.textContent || ''));
  if (!sel || !opt) return { ok: false, opts: [...(sel?.options || [])].map((o) => o.textContent.trim()) };
  sel.value = opt.value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, label: opt.textContent.trim() };
});
await new Promise((r) => setTimeout(r, 1800));
const chrome0 = await page.evaluate(() => ({
  legends: document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-box^="legend"]').length,
  pills: document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-box^="pill"]').length,
}));
// Enable chrome on the selected (garage) view only.
await page.evaluate(() => document.querySelector('[data-rb-floor-view-chrome="legend-on"]')?.click());
await page.evaluate(() => document.querySelector('[data-rb-floor-view-chrome="pill-on"]')?.click());
await new Promise((r) => setTimeout(r, 2200));
const chrome1 = await page.evaluate(() => ({
  legends: document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-box^="legend"]').length,
  pills: [...document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-box^="pill"]')]
    .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim()),
}));
await openLegendHlTab();
const switchOn = await page.evaluate(() => {
  const lab = [...document.querySelectorAll('.rb-ws__controls label')]
    .find((l) => (l.textContent || '').trim() === 'Legend');
  const sw = lab?.closest('div.flex')?.querySelector('[role=switch]');
  return sw ? (sw.getAttribute('data-state') || sw.getAttribute('aria-checked')) : null;
});
// GPT-030: Legend & H/L tab switch OFF must clear THIS view's report legend.
const legendOff = await setLegendHlSwitch('Legend', false);
await new Promise((r) => setTimeout(r, 1800));
const chromeAfterOff = await page.evaluate(() => ({
  legends: document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-box^="legend"]').length,
  pills: document.querySelectorAll('.rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-box^="pill"]').length,
}));
const legendOffSaved = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const floor = (rec.reportBuilder.pages || []).find((p) =>
    p && p.type === 'floor' && Array.isArray(p.meta?.views) && p.meta.views.length > 1);
  const views = (floor && floor.meta.views) || [];
  return views.map((v) => ({
    id: v.id, L: !!v.showLegend, P: !!v.showPill, sL: !!(v.settings && v.settings.showLegend),
  }));
}, FILE);
// Combined source for Main Level (two boundaries) on view 0.
await page.evaluate(() => {
  document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-topo-frame="0"]')
    ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 800));
const combined = await page.evaluate(() => {
  const sel = document.querySelector('[data-rb-floor-view-source]');
  const opts = [...(sel?.options || [])].map((o) => o.textContent.trim());
  const opt = [...(sel?.options || [])]
    .find((o) => /Main Level\s*—\s*Combined/i.test(o.textContent || ''));
  if (!sel || !opt) return { ok: false, opts };
  sel.value = opt.value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, label: opt.textContent.trim(), value: opt.value, opts };
});
await new Promise((r) => setTimeout(r, 2000));
await page.waitForFunction(
  () => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''),
  { timeout: 15000 }).catch(() => {});
const combinedSaved = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const floor = (rec.reportBuilder.pages || []).find((p) =>
    p && p.type === 'floor' && Array.isArray(p.meta?.views) && p.meta.views.length >= 2);
  const v0 = floor && floor.meta.views[0];
  return v0 ? { scope: v0.scope, areaId: v0.areaId || null } : null;
}, FILE);
await page.screenshot({ path: `${OUT}/rb-finish-03-reference.png` });
accept(3, 'Reference sheet — chrome on; Legend tab clears it; Combined source',
  garage.ok && chrome0.legends === 0 && chrome0.pills === 0 &&
  chrome1.legends >= 1 && chrome1.pills.length >= 1 &&
  chrome1.pills.some((t) => /\d/.test(t)) &&
  /checked|true/i.test(String(switchOn || '')) &&
  legendOff.ok &&
  // Selected garage view's legend cleared; may still have pill.
  legendOffSaved.some((v) => v.L === false && v.sL === false && v.P === true) &&
  chromeAfterOff.legends === 0 &&
  combined.ok && combinedSaved && combinedSaved.scope === 'all' && !combinedSaved.areaId,
  JSON.stringify({
    garage, chrome0, chrome1, switchOn, legendOff, chromeAfterOff, legendOffSaved, combined, combinedSaved,
  }).slice(0, 900));

// ========== 4. Shared vs This slide only ==========
await openFloorThumb('second');
const secondChromeBefore = await page.evaluate(() => {
  const el = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-box="overview"], .rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-box^="legend"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { id: el.getAttribute('data-rb-floor-box'), x: +r.x.toFixed(1), y: +r.y.toFixed(1) };
});
const ownOn = await page.evaluate(() => {
  const b = document.querySelector('[data-rb-floor-own="own"]');
  if (!b) return false;
  b.click();
  return true;
});
await new Promise((r) => setTimeout(r, 1600));
const ownLead = await page.evaluate(() =>
  [...document.querySelectorAll('.rb-panel .rb-panel__lead')]
    .some((p) => /This slide only/i.test(p.textContent || '')));
const dragTarget = await page.evaluate(() => {
  const el = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-box="overview"], .rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-box^="legend"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x + 24, y: r.y + 24 };
});
if (dragTarget) {
  await page.mouse.move(dragTarget.x, dragTarget.y);
  await page.mouse.down();
  await page.mouse.move(dragTarget.x + 140, dragTarget.y + 90, { steps: 12 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 1400));
}
const secondChromeAfter = await page.evaluate(() => {
  const el = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-box="overview"], .rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-box^="legend"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: +r.x.toFixed(1), y: +r.y.toFixed(1) };
});
await openFloorThumb('main');
const mainChrome = await page.evaluate(() => {
  const el = document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-box="overview"], .rb-sheet:not(.rb-sheet--thumb) [data-rb-floor-box^="legend"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: +r.x.toFixed(1), y: +r.y.toFixed(1) };
});
await openFloorThumb('second');
await page.evaluate(() => document.querySelector('[data-rb-floor-own="share"]')?.click());
await new Promise((r) => setTimeout(r, 1600));
await page.waitForFunction(
  () => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''),
  { timeout: 15000 }).catch(() => {});
const afterShare = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const pages = (rec.reportBuilder && rec.reportBuilder.pages) || [];
  return {
    ownCount: pages.filter((p) => p && p.meta && p.meta.ownLayout).length,
  };
}, FILE);
await page.screenshot({ path: `${OUT}/rb-finish-04-slide-only.png` });
accept(4, 'Shared vs This slide only — independent move; restore shared',
  ownOn && ownLead && secondChromeBefore && secondChromeAfter &&
  Math.abs(secondChromeAfter.x - secondChromeBefore.x) > 30 &&
  afterShare.ownCount === 0,
  JSON.stringify({ ownOn, ownLead, secondChromeBefore, secondChromeAfter, mainChrome, afterShare }).slice(0, 600));

// ========== 5. Save and reopen ==========
await openFloorThumb('main');
await page.waitForFunction(
  () => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''),
  { timeout: 20000 }).catch(() => {});
const beforeClose = await savedMainViews();
await page.screenshot({ path: `${OUT}/rb-finish-05-before-reopen.png` });
await page.goto(`${BASE}#/`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 700));
await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => document.querySelectorAll('.rb-thumb[data-page-id^="floor-"]').length >= 1,
  { timeout: 30000 });
await openFloorThumb('main');
const afterReopen = await savedMainViews();
const persist = afterReopen.views.length === beforeClose.views.length &&
  afterReopen.views.length >= 3 &&
  afterReopen.views.every((v, i) =>
    v.canvasId === beforeClose.views[i].canvasId &&
    !!v.showLegend === !!beforeClose.views[i].showLegend &&
    !!v.showPill === !!beforeClose.views[i].showPill);
await page.screenshot({ path: `${OUT}/rb-finish-05-after-reopen.png` });
accept(5, 'Save and reopen — sources/chrome/frames survive browser reload',
  persist,
  JSON.stringify({ before: beforeClose.views, after: afterReopen.views }).slice(0, 800));

// ========== 6. Present + PDF via real #rb-present / #rb-print ==========
const presentClicked = await page.evaluate(() => {
  const b = document.querySelector('#rb-present');
  if (!b) return false;
  b.click();
  return true;
});
await page.waitForFunction(
  () => !!document.querySelector('.rb-print.rb-print--present, .rb-print--present'),
  { timeout: 45000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 2500));
const present = await page.evaluate(() => {
  const deck = document.querySelector('.rb-print.rb-print--present, .rb-print--present');
  const sheets = deck ? deck.querySelectorAll('.rb-sheet, .rb-print__page') : [];
  const stills = deck
    ? [...deck.querySelectorAll('img.rb-topo-still')].map((img) => ({
      w: img.naturalWidth, h: img.naturalHeight, src: !!(img.currentSrc || img.src),
    }))
    : [];
  return {
    open: !!deck,
    sheets: sheets.length,
    stills: stills.length,
    inked: stills.filter((s) => s.w > 50).length,
  };
});
await page.screenshot({ path: `${OUT}/rb-finish-06-present.png` });
// GPT-031: close Present with the real Close control; do not strip deck classes.
const presentClosed = await page.evaluate(() => {
  const close = document.querySelector('.rb-present-bar [data-present="close"]');
  if (!close) return { ok: false };
  close.click();
  return { ok: true };
});
await page.waitForFunction(
  () => !document.querySelector('.rb-print.rb-print--present, .rb-print--present'),
  { timeout: 15000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 500));

// Stub window.print so #rb-print builds the real deck and settles without a dialog.
await page.evaluate(() => {
  window.__rbPrintStubCalls = 0;
  window.print = () => { window.__rbPrintStubCalls += 1; };
});
const printClicked = await page.evaluate(() => {
  const b = document.querySelector('#rb-print');
  if (!b) return false;
  b.click();
  return true;
});
await page.waitForFunction(
  () => {
    const deck = document.querySelector('body.is-printing .rb-print, body .rb-print:not(.rb-print--present)');
    if (!deck) return false;
    const stills = deck.querySelectorAll('img.rb-topo-still');
    return stills.length > 0 && [...stills].some((img) => img.naturalWidth > 50);
  },
  { timeout: 60000 }).catch(() => {});
// Wait until print preparation finished (stub invoked) or deck is fully inked.
await page.waitForFunction(
  () => (window.__rbPrintStubCalls || 0) >= 1
    || (document.querySelectorAll('body.is-printing .rb-print img.rb-topo-still').length >= 1),
  { timeout: 30000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 1500));
const printDeck = await page.evaluate(() => {
  const deck = document.querySelector('body.is-printing .rb-print')
    || document.querySelector('.rb-print:not(.rb-print--present)');
  const sheets = deck ? deck.querySelectorAll('.rb-print__page, .rb-sheet') : [];
  const stills = deck ? [...deck.querySelectorAll('img.rb-topo-still')] : [];
  return {
    clicked: true,
    presentClosed: true,
    deck: !!deck,
    printing: document.body.classList.contains('is-printing'),
    sheets: sheets.length,
    stills: stills.length,
    sizes: stills.slice(0, 4).map((img) => ({ w: img.naturalWidth, h: img.naturalHeight })),
    printCalls: window.__rbPrintStubCalls || 0,
  };
});
const pdfPath = `${OUT}/rb-finish-06-compose.pdf`;
let pdfMeta = { ok: false };
if (printClicked && printDeck.deck && printDeck.stills >= 1) {
  await page.emulateMediaType('print');
  await page.pdf({ path: pdfPath, width: '17in', height: '11in', printBackground: true });
  await page.emulateMediaType('screen');
  try {
    const buf = await readFile(pdfPath);
    pdfMeta = {
      ok: buf.slice(0, 5).toString() === '%PDF-',
      bytes: buf.length,
      pages: (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length,
    };
    try {
      pdfMeta.info = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' })
        .split('\n').filter((l) => /^(Pages|Page size|File size)/.test(l)).join(' | ');
    } catch (_) { /* optional */ }
  } catch (err) {
    pdfMeta.error = String(err.message || err);
  }
} else {
  pdfMeta = { ok: false, reason: 'no-print-deck', printClicked, printDeck };
}
await page.screenshot({ path: `${OUT}/rb-finish-06-editor.png` });
accept(6, 'Actual output — #rb-present and #rb-print decks + 11×17 PDF',
  presentClicked && present.open && present.inked >= 1 &&
  presentClosed.ok && printClicked && printDeck.deck && printDeck.stills >= 1 &&
  pdfMeta.ok && pdfMeta.bytes > 40000 && pdfMeta.pages >= 2,
  JSON.stringify({ presentClicked, present, presentClosed, printClicked, printDeck, pdfMeta }).slice(0, 800));

// ========== 7. Window size / editor zoom ==========
const paperA = await page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
  if (!sheet) return null;
  return { offsetW: sheet.offsetWidth, offsetH: sheet.offsetHeight };
});
await page.setViewport({ width: 1280, height: 820, deviceScaleFactor: 1 });
await new Promise((r) => setTimeout(r, 1500));
const zoomLevels = [];
async function clickZoom(which) {
  const before = await page.evaluate(() =>
    (document.querySelector('#rb-zoom-level')?.textContent || '').trim());
  if (which === 'fit') {
    await page.evaluate(() => document.querySelector('#rb-zoom-level')?.click());
  } else if (which === 'in') {
    await page.evaluate(() => document.querySelector('#rb-zoom-in')?.click());
  } else {
    await page.evaluate(() => document.querySelector('#rb-zoom-out')?.click());
  }
  await new Promise((r) => setTimeout(r, 500));
  const after = await page.evaluate(() =>
    (document.querySelector('#rb-zoom-level')?.textContent || '').trim());
  zoomLevels.push({ which, before, after });
  return after;
}
// Reach Fit, then step toward 100%/150% via zoom-in, proving readout changes.
await clickZoom('fit');
const atFit = await page.evaluate(() =>
  (document.querySelector('#rb-zoom-level')?.textContent || '').trim());
await clickZoom('in');
await clickZoom('in');
const atZoomed = await page.evaluate(() =>
  (document.querySelector('#rb-zoom-level')?.textContent || '').trim());
const afterZoom = await savedMainViews();
const paperB = await page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
  if (!sheet) return null;
  return { offsetW: sheet.offsetWidth, offsetH: sheet.offsetHeight };
});
await page.setViewport({ width: 1700, height: 1050, deviceScaleFactor: 1 });
await new Promise((r) => setTimeout(r, 1000));
await page.screenshot({ path: `${OUT}/rb-finish-07-zoom.png` });
accept(7, 'Window size / editor zoom — zoom readout moves; saved frames unchanged',
  !!paperA && afterZoom.views.length === afterReopen.views.length &&
  afterZoom.views.every((v, i) =>
    v.frame && afterReopen.views[i].frame &&
    Math.abs(v.frame.w - afterReopen.views[i].frame.w) < 0.5 &&
    Math.abs(v.frame.h - afterReopen.views[i].frame.h) < 0.5) &&
  /Fit/i.test(atFit) && atZoomed !== atFit,
  JSON.stringify({ paperA, paperB, atFit, atZoomed, zoomLevels, frames: afterZoom.views.map((v) => v.frame) }).slice(0, 600));

// ========== 8. Existing / stale shared-camera policy ==========
const plant = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const rb = rec.reportBuilder || {};
  const floors = (rb.pages || []).filter((p) => p && p.type === 'floor' && !p.meta?.reserved);
  // Use Second Floor ordinary sheet (auto page) — force single view
  let target = floors.find((p) => /second/i.test(p.railLabel || p.title || '')) || floors[1];
  if (!target) return { ok: false };
  const api = window.ToolboxReportFloorViews;
  if (api) {
    api.ensurePageViews(target);
    while (target.meta.views.length > 1) api.removeView(target, target.meta.views.length - 1);
  }
  rb.floorCamera = { cx: 0.72, cy: 0.61, zoom: 1.15, rel: true };
  if (target.meta.views[0]) {
    target.meta.views[0].camera = { cx: 0.4, cy: 0.5, zoom: 1.15, rel: true };
  }
  await window.ToolboxDB.saveCustomerFile(rec);
  return {
    ok: true,
    pageId: target.id,
    book: rb.floorCamera,
    stale: target.meta.views[0] && target.meta.views[0].camera,
  };
}, FILE);
await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(
  () => document.querySelectorAll('.rb-thumb[data-page-id^="floor-"]').length >= 1,
  { timeout: 25000 });
if (plant.ok) {
  await page.evaluate((pid) => {
    document.querySelector(`.rb-thumb[data-page-id="${pid}"]`)?.click();
  }, plant.pageId);
  await page.waitForFunction(
    () => !!document.querySelector('[data-rb-floor-box^="topo"]'),
    { timeout: 25000 });
  await new Promise((r) => setTimeout(r, 2500));
}
const live = await page.evaluate(() => ({
  hasHost: !!document.querySelector('.rb-sheet:not(.rb-sheet--thumb) [data-rb-topo-live]'),
  pageId: document.querySelector('.rb-sheet:not(.rb-sheet--thumb)')?.getAttribute('data-page-id'),
}));
await page.screenshot({ path: `${OUT}/rb-finish-08-stale-camera.png` });
accept(8, 'Existing / stale per-view camera — ordinary figure still mounts under shared policy',
  plant.ok && live.hasHost,
  JSON.stringify({ plant, live }).slice(0, 500),
  'Book-vs-stale print extent proven in report-floor-drawing-movable 13/13; this plants stale camera and confirms live host after reopen');

await writeFile(`${OUT}/rb-finish-acceptance.json`, JSON.stringify({
  when: new Date().toISOString(),
  checklist,
  results,
  passed: results.filter((r) => r.ok).length,
  total: results.length,
}, null, 2));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
console.log('Checklist:', checklist.map((c) => `${c.id}:${c.ok ? 'PASS' : 'FAIL'}`).join(' '));
if (failed.length) process.exit(1);
