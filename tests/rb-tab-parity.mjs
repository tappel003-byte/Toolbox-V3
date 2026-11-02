/**
 * Report Builder tab parity with Floor Survey capture folder tabs.
 * Parents Contours|Readings match TrialFolderTabs tokens; siblings are
 * TrialSectionTabs; grandparents Sheet Layout|Topo stay a separate gray level.
 * Run: node tests/rb-tab-parity.mjs  (static server on 8765)
 */
import { createRequire } from 'module';
import { mkdir, writeFile } from 'fs/promises';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
const FILE = 'rb-tab-parity';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const CAPTURE = {
  minHeight: 44,
  fontSize: 12,
  inactiveBg: 'rgb(229, 235, 238)', // #e5ebee
  inactiveColor: 'rgb(61, 92, 112)', // #3d5c70
  activeBg: 'rgb(7, 40, 61)', // #07283d
  activeColor: 'rgb(255, 255, 255)',
  radiusTop: 6,
};

function near(a, b, tol = 0.6) {
  return Math.abs(Number(a) - Number(b)) <= tol;
}

await mkdir(OUT, { recursive: true });
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
  await window.ToolboxDB.putMedia('plan-parity', c.toDataURL('image/jpeg', 0.9));
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Parity'; rec.lastName = 'Tabs';
  rec.propertyAddress = '2 Parity Lane';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Main Level';
  cv.plan = { id: 'plan-parity', width: 800, height: 600 };
  cv.frontDoorFacing = 'N';
  const poly = [{ x: 40, y: 40 }, { x: 760, y: 40 }, { x: 760, y: 560 }, { x: 40, y: 560 }];
  const points = [];
  for (let i = 1; i <= 8; i += 1) {
    points.push({ id: 'p' + i, floorId: cv.id, index: i, x: 80 + i * 70, y: 220, value: 4 + i * 0.25 });
  }
  rec.floorSurvey = {
    id: 'fs-parity', inspectionDate: '2026-11-02',
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
await new Promise((r) => setTimeout(r, 4000));
await page.evaluate(() => {
  const t = [...document.querySelectorAll('.rb-thumb[data-page-id^="floor-"]')]
    .find((el) => !/reserved/i.test(el.getAttribute('data-page-id') || ''))
    || [...document.querySelectorAll('.rb-thumb[data-page-id^="floor-"]')][0];
  t?.click();
});
await page.waitForFunction(
  () => !!document.querySelector('[data-rb-floor-import]') ||
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
    () => !!document.querySelector('[data-rb-floor-task]'),
    { timeout: 30000 },
  );
}
await new Promise((r) => setTimeout(r, 1800));

await page.evaluate(() => document.querySelector('[data-rb-floor-task="topo"]')?.click());
await page.waitForFunction(
  () => document.querySelectorAll('.rb-ws__subtab').length >= 2 &&
    !!document.querySelector('[data-fs-cp-section]'),
  { timeout: 20000 },
);
await new Promise((r) => setTimeout(r, 600));

const structure = await page.evaluate(() => {
  const grandparents = [...document.querySelectorAll('[data-rb-floor-task]')]
    .map((b) => b.textContent.trim());
  const parents = [...document.querySelectorAll('.rb-ws__subtab')]
    .map((b) => ({
      text: b.textContent.trim(),
      group: b.getAttribute('data-rb-topo-group'),
      selected: b.getAttribute('aria-selected') === 'true',
    }));
  const siblings = [...document.querySelectorAll('[data-fs-cp-section]')]
    .map((b) => b.textContent.trim());
  const task = document.querySelector('.rb-ws__task-tabs')?.getBoundingClientRect();
  const sub = document.querySelector('.rb-ws__subtabs')?.getBoundingClientRect();
  const overlap = task && sub ? sub.top < task.bottom - 2 : true;
  const gap = task && sub ? Math.round(sub.top - task.bottom) : null;
  const blue = [...document.querySelectorAll('.rb-ws__task-tab, .rb-ws__subtab')]
    .some((el) => {
      const bg = getComputedStyle(el).backgroundColor;
      return bg === 'rgb(197, 216, 228)' || bg === 'rgb(179, 205, 220)'; // #c5d8e4 / #b3cddc
    });
  return { grandparents, parents, siblings, overlap, gap, blue };
});

check(
  'grandparents remain Sheet Layout | Topo',
  structure.grandparents.join('|') === 'Sheet Layout|Topo',
  JSON.stringify(structure.grandparents),
);
check(
  'parents are Contours | Readings only',
  structure.parents.map((p) => p.text).join('|') === 'Contours|Readings'
    && structure.parents.every((p) => p.group === 'contours' || p.group === 'readings'),
  JSON.stringify(structure.parents),
);
check(
  'Contours siblings are Display | Colors | Lines',
  structure.siblings.join('|') === 'Display|Colors|Lines',
  JSON.stringify(structure.siblings),
);
check(
  'grandparents visibly separated from Contours|Readings (no overlap)',
  !structure.overlap && structure.gap != null && structure.gap >= 8,
  JSON.stringify({ gap: structure.gap, overlap: structure.overlap }),
);
check('no main blue palette on rail tabs', !structure.blue, JSON.stringify(structure));

const parentStyles = await page.evaluate(() => {
  function sample(sel, active) {
    const el = [...document.querySelectorAll(sel)].find((b) =>
      active ? b.classList.contains('is-active') || b.getAttribute('aria-selected') === 'true'
        : !(b.classList.contains('is-active') || b.getAttribute('aria-selected') === 'true'));
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      minHeight: parseFloat(cs.minHeight),
      fontSize: parseFloat(cs.fontSize),
      fontWeight: cs.fontWeight,
      bg: cs.backgroundColor,
      color: cs.color,
      radiusTL: parseFloat(cs.borderTopLeftRadius),
      padL: parseFloat(cs.paddingLeft),
    };
  }
  return {
    active: sample('.rb-ws__subtab', true),
    inactive: sample('.rb-ws__subtab', false),
  };
});

check(
  'RB parent active matches capture navy fill tokens',
  parentStyles.active
    && near(parentStyles.active.minHeight, CAPTURE.minHeight)
    && near(parentStyles.active.fontSize, CAPTURE.fontSize)
    && parentStyles.active.bg === CAPTURE.activeBg
    && parentStyles.active.color === CAPTURE.activeColor
    && near(parentStyles.active.radiusTL, CAPTURE.radiusTop),
  JSON.stringify(parentStyles.active),
);
check(
  'RB parent inactive matches capture gray tokens',
  parentStyles.inactive
    && near(parentStyles.inactive.minHeight, CAPTURE.minHeight)
    && near(parentStyles.inactive.fontSize, CAPTURE.fontSize)
    && parentStyles.inactive.bg === CAPTURE.inactiveBg
    && parentStyles.inactive.color === CAPTURE.inactiveColor,
  JSON.stringify(parentStyles.inactive),
);

await page.evaluate(() => document.querySelector('[data-rb-topo-group="readings"]')?.click());
await page.waitForFunction(
  () => [...document.querySelectorAll('[data-fs-cp-section]')]
    .map((b) => b.textContent.trim()).join('|') === 'Show|Format|Accessories',
  { timeout: 10000 },
);
const readingSiblings = await page.evaluate(() =>
  [...document.querySelectorAll('[data-fs-cp-section]')].map((b) => b.textContent.trim()));
check(
  'Readings siblings are Show | Format | Accessories',
  readingSiblings.join('|') === 'Show|Format|Accessories',
  JSON.stringify(readingSiblings),
);

const siblingStyles = await page.evaluate(() => {
  const active = document.querySelector('[data-fs-cp-section][aria-selected="true"]');
  const inactive = [...document.querySelectorAll('[data-fs-cp-section]')]
    .find((b) => b.getAttribute('aria-selected') !== 'true');
  function pack(el) {
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      minHeight: parseFloat(cs.minHeight) || el.getBoundingClientRect().height,
      fontSize: parseFloat(cs.fontSize),
      bg: cs.backgroundColor,
      color: cs.color,
      radiusTL: parseFloat(cs.borderTopLeftRadius),
    };
  }
  return { active: pack(active), inactive: pack(inactive) };
});
check(
  'RB sibling active matches capture navy folder chrome',
  siblingStyles.active
    && near(siblingStyles.active.minHeight, CAPTURE.minHeight, 2)
    && near(siblingStyles.active.fontSize, CAPTURE.fontSize)
    && siblingStyles.active.bg === CAPTURE.activeBg
    && siblingStyles.active.color === CAPTURE.activeColor,
  JSON.stringify(siblingStyles.active),
);
check(
  'RB sibling inactive matches capture gray folder chrome',
  siblingStyles.inactive
    && siblingStyles.inactive.bg === CAPTURE.inactiveBg
    && siblingStyles.inactive.color === CAPTURE.inactiveColor,
  JSON.stringify(siblingStyles.inactive),
);

await page.evaluate(() => document.querySelector('[data-fs-cp-section="accessories"]')?.click());
await page.waitForFunction(
  () => !!document.querySelector('[data-fs-accessories-air]')
    && /H\/L\/Δ pill/i.test(document.querySelector('[data-rb-topo-panel]')?.innerText || ''),
  { timeout: 8000 },
);
const accessories = await page.evaluate(() => {
  const panel = document.querySelector('[data-rb-topo-panel]');
  const text = panel?.innerText || '';
  return {
    air: !!document.querySelector('[data-fs-accessories-air]'),
    pointSize: /Point size/i.test(text),
    legend: /Legend/i.test(text),
    pill: /H\/L\/Δ pill/i.test(text),
    highLow: /High \/ low/i.test(text),
    segmented: !!document.querySelector('[aria-label="Accessories"][role="tablist"].grid'),
  };
});
check(
  'Accessories under Readings keeps report visibility controls (no segmented strip)',
  accessories.air && accessories.pointSize && accessories.legend
    && accessories.pill && accessories.highLow && !accessories.segmented,
  JSON.stringify(accessories),
);

await page.evaluate(() => document.querySelector('[data-fs-cp-section="format"]')?.click());
await new Promise((r) => setTimeout(r, 300));
const formatReset = await page.evaluate(() =>
  /Reset label positions/i.test(document.querySelector('[data-rb-topo-panel]')?.innerText || ''));
check('Format keeps Reset label positions', formatReset);

await page.screenshot({ path: `${OUT}/rb-tab-parity-topo-parents.png`, fullPage: false });
await page.evaluate(() => document.querySelector('[data-fs-cp-section="accessories"]')?.click());
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: `${OUT}/rb-tab-parity-accessories.png`, fullPage: false });

// Capture Control panel chrome — open field Topo Control panel for style compare.
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(`${BASE}#/file/${FILE}/floor`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1200));
for (let i = 0; i < 6; i += 1) {
  const state = await page.evaluate(() => {
    const t = document.body.innerText || '';
    return {
      field: /\bData\b/.test(t) && /\bTopo\b/.test(t),
      start: [...document.querySelectorAll('button')].some((b) => /Start surveying/i.test(b.textContent || '')),
      next: [...document.querySelectorAll('button')].some((b) => /^Next:/.test((b.textContent || '').trim())),
    };
  });
  if (state.field) break;
  if (state.start) {
    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find((b) => /Start surveying/i.test(b.textContent || ''))?.click();
    });
    await new Promise((r) => setTimeout(r, 700));
    continue;
  }
  if (state.next) {
    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find((b) => /^Next:/.test((b.textContent || '').trim()))?.click();
    });
    await new Promise((r) => setTimeout(r, 400));
  }
}
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Topo')?.click();
});
await new Promise((r) => setTimeout(r, 800));
const captureOpened = await page.evaluate(() => {
  const btn = document.querySelector('[aria-label="Control panel"]');
  btn?.click();
  return !!btn;
});
await page.waitForFunction(() => !!document.querySelector('[data-fs-cp="panel"]'), { timeout: 10000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 400));
const captureStyles = await page.evaluate(() => {
  const panel = document.querySelector('[data-fs-cp="panel"]');
  const active = panel?.querySelector('[data-fs-cp-tab][aria-selected="true"]')
    || panel?.querySelector('[data-fs-cp-tab="contours"]');
  const inactive = [...(panel?.querySelectorAll('[data-fs-cp-tab]') || [])]
    .find((b) => b.getAttribute('aria-selected') !== 'true');
  function pack(el) {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      height: r.height,
      fontSize: parseFloat(cs.fontSize),
      bg: cs.backgroundColor,
      color: cs.color,
    };
  }
  const sections = [...(panel?.querySelectorAll('[data-fs-cp-section]') || [])]
    .map((b) => b.textContent.trim());
  return {
    opened: !!panel,
    active: pack(active),
    inactive: pack(inactive),
    sections,
  };
});
check(
  'capture Contours|Readings still navy/gray folder chrome',
  captureOpened && captureStyles.active
    && captureStyles.active.bg === CAPTURE.activeBg
    && captureStyles.active.color === CAPTURE.activeColor
    && near(captureStyles.active.fontSize, CAPTURE.fontSize)
    && captureStyles.active.height >= 40
    && captureStyles.inactive
    && captureStyles.inactive.bg === CAPTURE.inactiveBg
    && captureStyles.inactive.color === CAPTURE.inactiveColor,
  JSON.stringify(captureStyles),
);
if (captureStyles.active) {
  await page.screenshot({ path: `${OUT}/rb-tab-parity-capture-parents.png`, fullPage: false });
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
await writeFile(`${OUT}/rb-tab-parity-results.json`, JSON.stringify(results, null, 2));
await browser.close();
if (failed) process.exit(1);
