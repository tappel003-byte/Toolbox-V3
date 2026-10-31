/**
 * Sizing ownership — workflow acceptance.
 *
 * 1. Change capture sizes in Floor Survey → report stays unchanged
 * 2. Change report pill in the rail → capture + other Customer File unchanged
 * 3. Reopen → each retains settings; new report with missing sizes + poisoned
 *    device prefs seeds sheet defaults, not the poison
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

async function seedFile(id, name, opts = {}) {
  return page.evaluate(async ({ id, name, withReport, missingPill }) => {
    const planId = 'plan-' + id;
    const c = document.createElement('canvas');
    c.width = 800;
    c.height = 600;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 800, 600);
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 4;
    ctx.strokeRect(20, 20, 760, 560);
    await window.ToolboxDB.putMedia(planId, c.toDataURL('image/png'));

    const rec = window.ToolboxApp.blankCustomerFile(id);
    window.ToolboxPlanSetup.ensurePlanSetup(rec);
    rec.firstName = name;
    rec.lastName = 'Owner';
    rec.propertyAddress = '1 Size St';
    const cv = rec.planSetup.canvases[0];
    cv.name = 'Main Level';
    cv.plan = { id: planId, width: 800, height: 600 };
    cv.frontDoorFacing = 'N';
    const canvasId = cv.id;
    window.ToolboxPlanSetup.ensurePlanSetup(rec);
    window.ToolboxPlanSetup.ensureFloorSurveyCanvasRef(rec, canvasId);

    const poly = [
      { x: 40, y: 40 }, { x: 760, y: 40 }, { x: 760, y: 560 }, { x: 40, y: 560 },
    ];
    const points = [];
    for (let i = 1; i <= 6; i += 1) {
      points.push({
        id: 'p' + i,
        floorId: canvasId,
        index: i,
        x: 120 + i * 90,
        y: 200,
        value: 5 + i * 0.4,
      });
    }
    rec.floorSurvey = {
      id: 'fs-' + id,
      inspectionDate: '2026-10-26',
      byCanvasId: {
        [canvasId]: {
          canvasId,
          points,
          areas: [{ id: 'a1', name: 'Main Level', polygon: poly, createdAt: 1 }],
          boundary: poly,
        },
      },
    };

    const chrome = (window.ToolboxReportFloorLayout &&
      Number(window.ToolboxReportFloorLayout.CHROME_SCALE)) || (1632 / 1220);

    if (withReport) {
      // Seed floorLayout only — do not mark pages imported. Import runs in the
      // UI so the rail and live drawing are real (chrome / task-tabs pattern).
      const pillLock = missingPill
        ? { locked: true, scale: null }
        : { locked: true, scale: chrome };
      rec.reportBuilder = rec.reportBuilder || { version: 1, pages: [] };
      rec.reportBuilder.floorLayout = window.ToolboxReportFloorLayout
        ? window.ToolboxReportFloorLayout.normalizeLayout({
          legendLock: { locked: true, scale: 1.2 },
          pillLock,
        })
        : { legendLock: { locked: true, scale: 1.2 }, pillLock };
    }

    await window.ToolboxDB.saveCustomerFile(rec);
    return {
      id,
      canvasId,
      chrome,
      pillScale: rec.reportBuilder?.floorLayout?.pillLock?.scale ?? null,
    };
  }, {
    id,
    name,
    withReport: opts.withReport !== false,
    missingPill: !!opts.missingPill,
  });
}

async function reachTopo(fileId) {
  await page.goto(BASE + `#/file/${fileId}/floor`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1000));
  for (let i = 0; i < 6; i++) {
    const state = await page.evaluate(() => {
      const t = document.body.innerText || '';
      return {
        field: /\bData\b/.test(t) && /\bTopo\b/.test(t),
        start: [...document.querySelectorAll('button')].some((b) =>
          /Start surveying/i.test(b.textContent || '')),
        next: [...document.querySelectorAll('button')].some((b) =>
          /^Next:/.test((b.textContent || '').trim())),
        topoStep: [...document.querySelectorAll('button')].some((b) =>
          /3\.\s*Topo boundary/i.test(b.textContent || '')),
      };
    });
    if (state.field) break;
    if (state.start) {
      await page.evaluate(() => {
        [...document.querySelectorAll('button')]
          .find((b) => /Start surveying/i.test(b.textContent || ''))
          ?.click();
      });
      await new Promise((r) => setTimeout(r, 700));
      continue;
    }
    if (state.next) {
      await page.evaluate(() => {
        [...document.querySelectorAll('button')]
          .find((b) => /^Next:/.test((b.textContent || '').trim()))
          ?.click();
      });
      await new Promise((r) => setTimeout(r, 400));
      continue;
    }
    if (state.topoStep) {
      await page.evaluate(() => {
        [...document.querySelectorAll('button')]
          .find((b) => /3\.\s*Topo boundary/i.test(b.textContent || ''))
          ?.click();
      });
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find((b) => (b.textContent || '').trim() === 'Topo')
      ?.click();
  });
  await new Promise((r) => setTimeout(r, 800));
}

async function openControlPanel() {
  await page.evaluate(() => document.querySelector('[aria-label="Control panel"]')?.click());
  await new Promise((r) => setTimeout(r, 300));
}

async function clickCpTab(text) {
  await page.evaluate((text) => {
    const panel = document.querySelector('[data-fs-cp="panel"]');
    const btn = [...(panel?.querySelectorAll('[role="tab"]') || [])].find(
      (b) => (b.textContent || '').trim() === text,
    );
    btn?.click();
  }, text);
  await new Promise((r) => setTimeout(r, 150));
}

async function bumpStatsPillPlus() {
  return page.evaluate(() => {
    const body = document.querySelector('[data-fs-cp-section-body]');
    if (!body) return { ok: false, reason: 'no body' };
    const rows = [...body.querySelectorAll('div')].filter((d) =>
      /Stats pill size/i.test(d.textContent || ''),
    );
    const row = rows[0];
    if (!row) return { ok: false, reason: 'no stepper', text: body.innerText };
    const buttons = [...row.querySelectorAll('button')];
    const inc = buttons[buttons.length - 1];
    if (!inc) return { ok: false, reason: 'no plus' };
    for (let i = 0; i < 4; i++) inc.click();
    const val = row.querySelector('input')?.value || row.innerText;
    return { ok: true, val };
  });
}

/** Open report, import floor slide, wait for topo pieces (proven chrome pattern). */
async function openReportSlide(fileId) {
  await page.goto(BASE + `#/file/${fileId}/report`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(
    () => !!document.querySelector('.rb-sheet') ||
      !!document.querySelector('.rb-thumb[data-page-id^="floor-"]'),
    { timeout: 40000 },
  );
  await new Promise((r) => setTimeout(r, 2000));
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('.rb-thumb[data-page-id^="floor-"]')]
      .find((el) => !/reserved/i.test(el.getAttribute('data-page-id') || ''))
      || document.querySelector('.rb-thumb[data-page-id^="floor-"]');
    t?.click();
  });
  await page.waitForFunction(
    () => !!document.querySelector('[data-rb-floor-import]') ||
      !!document.querySelector('[data-rb-floor-box^="topo"]') ||
      !!document.querySelector('[data-rb-floor-task]'),
    { timeout: 25000 },
  ).catch(() => null);
  if (await page.$('[data-rb-floor-import]')) {
    await page.click('[data-rb-floor-import]');
    await page.waitForFunction(
      () => !!document.querySelector('[data-rb-floor-box^="topo"]') ||
        !!document.querySelector('[data-rb-floor-task]'),
      { timeout: 30000 },
    ).catch(() => null);
  }
  await new Promise((r) => setTimeout(r, 2200));
}

async function openLegendHlRail() {
  await page.evaluate(() => {
    document.querySelector('[data-rb-floor-task="topo"]')?.click();
  });
  await new Promise((r) => setTimeout(r, 500));
  await page.evaluate(() => {
    document.querySelector('[data-rb-rail-tab="legendhl"]')?.click() ||
      document.querySelector('[data-rb-topo-group="legendhl"]')?.click();
  });
  await new Promise((r) => setTimeout(r, 600));
}

async function bumpRailStatsPill() {
  return page.evaluate(() => {
    const host = document.querySelector('.rb-ws__controls') ||
      document.querySelector('#rb-rail') ||
      document.body;
    const label = [...host.querySelectorAll('*')].find((el) => {
      const t = (el.textContent || '').trim();
      return t === 'Stats pill size' || /^Stats pill size/i.test(t);
    });
    if (!label) {
      return {
        ok: false,
        reason: 'no stepper',
        text: (host.innerText || '').slice(0, 500),
      };
    }
    let row = label;
    for (let i = 0; i < 6 && row; i++) {
      if (row.querySelectorAll('button').length >= 2) break;
      row = row.parentElement;
    }
    const buttons = [...(row?.querySelectorAll('button') || [])];
    const inc = buttons[buttons.length - 1];
    if (!inc) return { ok: false, reason: 'no plus' };
    const before = row?.querySelector('input')?.value || '';
    for (let i = 0; i < 3; i++) inc.click();
    return { ok: true, before, after: row?.querySelector('input')?.value || '' };
  });
}

await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map((r) => r.unregister()));
  const keys = await caches.keys();
  await Promise.all(keys.map((k) => caches.delete(k)));
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
  localStorage.clear();
});
// Reload so the app runs without a stale service worker shell.
await page.goto(BASE, { waitUntil: 'networkidle0' });

const a = await seedFile('size-a', 'Alpha');
const b = await seedFile('size-b', 'Beta');

// Poison device-global prefs — must never win for report.
await page.evaluate(() => {
  localStorage.setItem('stats-chip-size', '96');
  localStorage.setItem('dpp-size:size-a', '8');
  localStorage.setItem('topo.legend.v1', JSON.stringify({ scale: 3.5, x: 1, y: 1 }));
});

const beforeReport = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  return {
    pill: rec.reportBuilder?.floorLayout?.pillLock?.scale,
    legend: rec.reportBuilder?.floorLayout?.legendLock?.scale,
  };
}, a.id);

// --- 1) Capture adjustment via Control panel ---
await reachTopo(a.id);
await openControlPanel();
await clickCpTab('Readings');
await clickCpTab('High / Low');
const bumped = await bumpStatsPillPlus();
check('Capture Control panel opened Stats pill stepper', bumped.ok, JSON.stringify(bumped));

const afterCapture = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  return {
    pill: rec.reportBuilder?.floorLayout?.pillLock?.scale,
    legend: rec.reportBuilder?.floorLayout?.legendLock?.scale,
    capturePill: localStorage.getItem('stats-chip-size:' + id),
    captureBlob: localStorage.getItem('fs-capture-sizes:' + id),
    globalPoison: localStorage.getItem('stats-chip-size'),
  };
}, a.id);
check(
  '1) Capture pill change does not alter report floorLayout',
  afterCapture.pill === beforeReport.pill && afterCapture.legend === beforeReport.legend,
  JSON.stringify({ beforeReport, afterCapture }),
);
check(
  '1b) Capture wrote per-file pill key, not only the global poison',
  !!afterCapture.capturePill && afterCapture.capturePill !== '96',
  JSON.stringify(afterCapture),
);

// Capture dpp-size poisoned — print/compose path must not read it.
const dotIsolation = await page.evaluate(async (id) => {
  localStorage.setItem('dpp-size:' + id, '8');
  const reads = [];
  const orig = Storage.prototype.getItem;
  Storage.prototype.getItem = function (key) {
    const k = String(key);
    if (k.indexOf('dpp-size') === 0 || k.indexOf('fs-capture-sizes') === 0) {
      reads.push(k);
    }
    return orig.call(this, key);
  };
  let composed = false;
  let err = null;
  try {
    const api = window.ToolboxFloorSurvey;
    const rec = await window.ToolboxDB.getCustomerFile(id);
    const canvasId = rec?.planSetup?.activeCanvasId ||
      (rec?.planSetup?.canvases && rec.planSetup.canvases[0]?.id);
    const layer = rec?.floorSurvey?.byCanvasId?.[canvasId];
    if (api && typeof api.composeReportTopoFigure === 'function' && layer) {
      const floor = {
        id: canvasId,
        projectId: id,
        name: 'Main Level',
        order: 0,
        planWidth: 800,
        planHeight: 600,
        boundary: layer.boundary,
        areas: layer.areas,
        transitions: layer.transitions || [],
      };
      const out = await api.composeReportTopoFigure({
        floor,
        points: layer.points || [],
        areaId: 'a1',
        extent: { x: 0, y: 0, w: 800, h: 600 },
      });
      composed = !!(out && out.dataUrl && out.width);
    }
  } catch (e) {
    err = String(e && e.message ? e.message : e);
  }
  Storage.prototype.getItem = orig;
  return {
    capture: Number(localStorage.getItem('dpp-size:' + id)),
    reads,
    composed,
    err,
  };
}, a.id);
check(
  '1c) Report compose does not read capture dpp-size / capture-sizes',
  dotIsolation.capture === 8 &&
    Array.isArray(dotIsolation.reads) &&
    dotIsolation.reads.length === 0 &&
    !!dotIsolation.composed,
  JSON.stringify(dotIsolation),
);

await page.screenshot({ path: `${OUT}/sizing-own-1-capture.png` });

// --- 2) Report rail adjustment ---
await openReportSlide(a.id);
await openLegendHlRail();

const railBefore = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  return {
    pill: rec.reportBuilder?.floorLayout?.pillLock?.scale,
    capturePill: localStorage.getItem('stats-chip-size:' + id),
  };
}, a.id);

const railStepper = await bumpRailStatsPill();
await new Promise((r) => setTimeout(r, 800));

const afterRail = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  return {
    pill: rec.reportBuilder?.floorLayout?.pillLock?.scale,
    capturePill: localStorage.getItem('stats-chip-size:' + id),
    captureBlob: localStorage.getItem('fs-capture-sizes:' + id),
    globalPoison: localStorage.getItem('stats-chip-size'),
  };
}, a.id);

const bAfterRail = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  return {
    pill: rec.reportBuilder?.floorLayout?.pillLock?.scale,
    capturePill: localStorage.getItem('stats-chip-size:' + id),
  };
}, b.id);

check(
  'Report rail Legend & H/L reachable with Stats pill stepper',
  railStepper.ok,
  JSON.stringify(railStepper),
);
check(
  '2) Rail pill change updates report lock',
  railStepper.ok &&
    (afterRail.pill !== railBefore.pill || railStepper.after !== railStepper.before),
  JSON.stringify({ railBefore, afterRail, railStepper }),
);
check(
  '2a) Rail pill change leaves capture keys for that file alone',
  afterRail.capturePill === afterCapture.capturePill,
  JSON.stringify({ afterRail, afterCapture }),
);
check(
  '2b) Other Customer File report + capture untouched',
  bAfterRail.pill === b.pillScale && !bAfterRail.capturePill,
  JSON.stringify({ bAfterRail, seed: b.pillScale }),
);

// Live report canvas must ignore capture pill events (settingsOwnedByHost).
const livePillBefore = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  return {
    pill: rec.reportBuilder?.floorLayout?.pillLock?.scale,
    capturePill: localStorage.getItem('stats-chip-size:' + id),
  };
}, a.id);
await page.evaluate(() => {
  window.dispatchEvent(
    new CustomEvent('stats-chip-size-change', {
      detail: { size: 96, customerFileId: 'size-a' },
    }),
  );
});
await new Promise((r) => setTimeout(r, 400));
const livePillAfter = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  return {
    pill: rec.reportBuilder?.floorLayout?.pillLock?.scale,
    capturePill: localStorage.getItem('stats-chip-size:' + id),
  };
}, a.id);
check(
  '2c) Capture pill event leaves report pillLock + capture key alone while live canvas open',
  Number(livePillAfter.pill) === Number(livePillBefore.pill) &&
    livePillAfter.capturePill === livePillBefore.capturePill,
  JSON.stringify({ livePillBefore, livePillAfter }),
);

await page.screenshot({ path: `${OUT}/sizing-own-2-rail.png` });

// --- 3) Reopen + new report with missing pill + poison ---
await page.goto(BASE, { waitUntil: 'networkidle0' });
const reopened = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  return {
    pill: rec.reportBuilder?.floorLayout?.pillLock?.scale,
    capturePill: localStorage.getItem('stats-chip-size:' + id),
    globalStill: localStorage.getItem('stats-chip-size'),
  };
}, a.id);
check(
  '3) Reopen keeps report pill lock and capture pill for that file',
  Number(reopened.pill) === Number(afterRail.pill) &&
    reopened.capturePill === afterCapture.capturePill &&
    reopened.globalStill === '96',
  JSON.stringify({ reopened, afterRail, afterCapture }),
);

const fresh = await seedFile('size-new', 'NewJob', { missingPill: true });
await page.evaluate(() => {
  localStorage.setItem('stats-chip-size', '96');
});
await openReportSlide(fresh.id);

const seeded = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const chrome = window.ToolboxReportFloorLayout.CHROME_SCALE;
  const scale = rec.reportBuilder?.floorLayout?.pillLock?.scale;
  const poisonPx = 96;
  const fromPoison = (poisonPx / 32) * chrome;
  return {
    scale,
    chrome,
    fromPoison,
    usedPoison: Math.abs(Number(scale) - fromPoison) < 0.05,
    nearDefault: Math.abs(Number(scale) - chrome) < 0.05,
    global: localStorage.getItem('stats-chip-size'),
  };
}, fresh.id);

check(
  '3b) New report with missing pill seeds sheet default, not device poison 96',
  seeded.nearDefault && !seeded.usedPoison && seeded.global === '96',
  JSON.stringify(seeded),
);

await page.screenshot({ path: `${OUT}/sizing-own-3-reopen-seed.png` });

const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `FAILED ${failed.length}/${results.length}` : `ALL PASSED ${results.length}`);
await browser.close();
process.exit(failed.length ? 1 : 0);
