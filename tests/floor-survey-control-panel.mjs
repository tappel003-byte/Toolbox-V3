/**
 * Field Control panel grouping: Contours / Readings / Misc folder tabs.
 * Run: node tests/floor-survey-control-panel.mjs  (static server on 8765)
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

async function seed() {
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  return page.evaluate(async () => {
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
    c.width = 400;
    c.height = 300;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 400, 300);
    ctx.strokeStyle = '#333';
    ctx.strokeRect(20, 20, 360, 260);
    const id = 'fs-cp-1';
    const canvasId = 'canvas-cp-1';
    const planId = 'plan-cp-1';
    await window.ToolboxDB.putMedia(planId, c.toDataURL('image/png'));
    let rec = window.ToolboxApp.blankCustomerFile(id);
    window.ToolboxPlanSetup.ensurePlanSetup(rec);
    rec.firstName = 'Panel';
    rec.lastName = 'Tester';
    rec.propertyAddress = '10 Tab St';
    rec.planSetup.canvases = [{
      id: canvasId,
      name: 'Main Level',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      plan: { id: planId, width: 400, height: 300 },
      rooms: [],
      frontDoorFacing: 'S',
      frontDoor: null,
    }];
    rec.planSetup.activeCanvasId = canvasId;
    window.ToolboxPlanSetup.ensurePlanSetup(rec);
    window.ToolboxPlanSetup.ensureFloorSurveyCanvasRef(rec, canvasId);
    await window.ToolboxDB.saveCustomerFile(rec);
    return { id, canvasId };
  });
}

async function reachTopo() {
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '3. Topo boundary');
    btn?.click();
  });
  await new Promise((r) => setTimeout(r, 300));
  const box = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  for (const [nx, ny] of [[0.2, 0.25], [0.8, 0.25], [0.8, 0.75], [0.2, 0.75], [0.2, 0.25]]) {
    await page.mouse.click(box.x + box.w * nx, box.y + box.h * ny);
    await new Promise((r) => setTimeout(r, 150));
  }
  await page.evaluate(() => {
    const closeBtn = [...document.querySelectorAll('button')].find((b) =>
      /^Close$|Close shape|Finish/i.test((b.textContent || '').trim()),
    );
    closeBtn?.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  for (let i = 0; i < 4; i++) {
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
}

function tabLabels(role) {
  return page.evaluate((role) => {
    const panel = document.querySelector('[data-fs-cp="panel"]');
    if (!panel) return [];
    return [...panel.querySelectorAll(`[role="tablist"]`)].map((list) =>
      [...list.querySelectorAll('[role="tab"]')].map((b) => ({
        text: (b.textContent || '').trim(),
        selected: b.getAttribute('aria-selected') === 'true',
        id: b.id,
      })),
    );
  }, role);
}

async function clickTab(text) {
  const hit = await page.evaluate((text) => {
    const panel = document.querySelector('[data-fs-cp="panel"]');
    if (!panel) return false;
    const btn = [...panel.querySelectorAll('[role="tab"]')].find((b) => (b.textContent || '').trim() === text);
    if (!btn) return false;
    btn.click();
    return true;
  }, text);
  await new Promise((r) => setTimeout(r, 150));
  return hit;
}

async function bodyText() {
  return page.evaluate(() => {
    const body = document.querySelector('[data-fs-cp-section-body]');
    return body ? (body.innerText || '') : '';
  });
}

async function layout() {
  return page.evaluate(() => {
    const panel = document.querySelector('[data-fs-cp="panel"]');
    if (!panel) return { open: false };
    const pr = panel.getBoundingClientRect();
    const tabs = [...panel.querySelectorAll('[role="tab"]')].map((b) => {
      const r = b.getBoundingClientRect();
      return {
        text: (b.textContent || '').trim(),
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        clipped: b.scrollWidth > b.clientWidth + 1,
        inPanel: r.left >= pr.left - 1 && r.right <= pr.right + 1 && r.top >= pr.top - 1 && r.bottom <= pr.bottom + 1,
      };
    });
    const close = panel.querySelector('[aria-label="Close"]');
    const cr = close ? close.getBoundingClientRect() : null;
    let overlap = false;
    for (let i = 0; i < tabs.length; i++) {
      for (let j = i + 1; j < tabs.length; j++) {
        const a = tabs[i];
        const b = tabs[j];
        if (Math.abs(a.y - b.y) > 8) continue;
        const ax2 = a.x + a.w;
        const bx2 = b.x + b.w;
        if (a.x < bx2 - 1 && ax2 > b.x + 1) overlap = true;
      }
    }
    return {
      open: true,
      panel: { x: Math.round(pr.x), y: Math.round(pr.y), w: Math.round(pr.width), h: Math.round(pr.height) },
      close: cr ? { x: Math.round(cr.x), y: Math.round(cr.y), w: Math.round(cr.width), h: Math.round(cr.height) } : null,
      tabs,
      overlap,
      back: /← Back|Back/.test(panel.innerText || '') && [...panel.querySelectorAll('button')].some((b) => /Back/.test(b.textContent || '')),
    };
  });
}

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const ids = await seed();
await page.goto(BASE + `#/file/${ids.id}/floor`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1200));
await reachTopo();

const opened = await page.evaluate(() => {
  const btn = document.querySelector('[aria-label="Control panel"]');
  btn?.click();
  return {
    ok: !!btn,
    href: location.href,
    text: (document.body.innerText || '').slice(0, 900),
    buttons: [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).filter(Boolean).slice(0, 30),
  };
});
await new Promise((r) => setTimeout(r, 300));
check('Control panel pill opens the panel', opened.ok, opened.text?.slice(0, 200));

let rows = await tabLabels();
check(
  'Phone Contours shows Legend Display Colors Lines, Legend first and selected',
  rows[0]?.map((t) => t.text).join('|') === 'Contours|Readings|Misc' &&
    rows[1]?.map((t) => t.text).join('|') === 'Legend|Display|Colors|Lines' &&
    rows[1]?.[0]?.selected === true,
  JSON.stringify(rows),
);
let lay = await layout();
check('Phone Contours tabs do not overlap or clip', lay.open && !lay.overlap && lay.tabs.every((t) => t.inPanel && !t.clipped && t.h >= 40), JSON.stringify(lay));
check('Close sits in the panel and is a touch target', lay.close && lay.close.w >= 40 && lay.close.h >= 40 && lay.close.y < lay.tabs[0].y, JSON.stringify(lay.close));
await page.screenshot({ path: `${OUT}/fs-cp-phone-contours-legend.png` });

const legendBefore = await page.evaluate(() => {
  const row = [...document.querySelectorAll('[data-fs-cp-section-body] div')].find((d) => /Legend/.test(d.textContent || '') && d.querySelector('[role="switch"]'));
  return row?.querySelector('[role="switch"]')?.getAttribute('aria-checked') || null;
});
await page.evaluate(() => {
  const row = [...document.querySelectorAll('[data-fs-cp-section-body] div')].find((d) => (d.textContent || '').trim().startsWith('Legend') && d.querySelector('[role="switch"]'));
  row?.querySelector('[role="switch"]')?.click();
});
await new Promise((r) => setTimeout(r, 200));
const legendAfter = await page.evaluate(() => {
  const row = [...document.querySelectorAll('[data-fs-cp-section-body] div')].find((d) => (d.textContent || '').trim().startsWith('Legend') && d.querySelector('[role="switch"]'));
  return row?.querySelector('[role="switch"]')?.getAttribute('aria-checked') || null;
});
check('Legend switch changes its setting', legendBefore && legendAfter && legendBefore !== legendAfter, `${legendBefore} -> ${legendAfter}`);

check('Display tab opens', await clickTab('Display'));
check('Display has mode, contours, and floor plan', /Mode/.test(await bodyText()) && /Contours on/.test(await bodyText()) && /Floor plan/.test(await bodyText()));
await page.screenshot({ path: `${OUT}/fs-cp-phone-contours-display.png` });

check('Colors tab opens', await clickTab('Colors'));
check('Colors has reverse and a palette', /Reverse/.test(await bodyText()));
await page.screenshot({ path: `${OUT}/fs-cp-phone-contours-colors.png` });

check('Lines tab opens', await clickTab('Lines'));
const lines = await bodyText();
check('Lines has first, step, count, and thickness', /First/.test(lines) && /Step/.test(lines) && /Count/.test(lines) && /Line thickness/.test(lines));
await page.screenshot({ path: `${OUT}/fs-cp-phone-contours-lines.png` });

check('Readings parent opens', await clickTab('Readings'));
rows = await tabLabels();
check('Readings children are Show and Font', rows[1]?.map((t) => t.text).join('|') === 'Show|Font' && rows[1][0].selected, JSON.stringify(rows[1]));
lay = await layout();
check('Phone Readings tabs do not overlap or clip', !lay.overlap && lay.tabs.every((t) => t.inPanel && !t.clipped && t.h >= 40), JSON.stringify(lay.tabs));
check('Show has points and labels only', /Points/.test(await bodyText()) && /Labels/.test(await bodyText()) && !/Decimals/.test(await bodyText()));
await page.screenshot({ path: `${OUT}/fs-cp-phone-readings-show.png` });

check('Font tab opens', await clickTab('Font'));
const font = await bodyText();
check(
  'Font has size, weight, color, and background, not decimals',
  /Point label size/.test(font) && /Weight/.test(font) && /Color/.test(font) && /Label bg/.test(font) && /Box/.test(font) && /Border/.test(font) && /Plain/.test(font) && !/Decimals/.test(font) && !/Declutter/.test(font),
  font.replace(/\n/g, ' | '),
);
await page.screenshot({ path: `${OUT}/fs-cp-phone-readings-font.png` });

check('Misc parent opens', await clickTab('Misc'));
rows = await tabLabels();
check(
  'Misc children are Adjustments, High / Low, Positions',
  rows[1]?.map((t) => t.text).join('|') === 'Adjustments|High / Low|Positions' && rows[1][0].selected,
  JSON.stringify(rows[1]),
);
lay = await layout();
check('Phone Misc tabs do not overlap or clip', !lay.overlap && lay.tabs.every((t) => t.inPanel && !t.clipped && t.h >= 40), JSON.stringify(lay.tabs));
const adj = await bodyText();
check('Adjustments has decimals and declutter', /Decimals/.test(adj) && /Declutter/.test(adj), adj.replace(/\n/g, ' | '));
await page.screenshot({ path: `${OUT}/fs-cp-phone-misc-adjustments.png` });

check('High / Low tab opens', await clickTab('High / Low'));
const hl = await bodyText();
check(
  'High / Low has the marker switch, marker size, and stats pill size',
  /High \/ low/.test(hl) && /Marker size/.test(hl) && /Stats pill size/.test(hl),
  hl.replace(/\n/g, ' | '),
);
check('Capture panel does not invent a stats-pill visibility switch', !/H\/L\/Δ pill/.test(hl) || !hl.includes('H/L/Δ pill\n'), hl.replace(/\n/g, ' | '));
await page.screenshot({ path: `${OUT}/fs-cp-phone-misc-highlow.png` });

check('Positions tab opens', await clickTab('Positions'));
check('Positions keeps the reset action', /Reset label & H\/L positions/.test(await bodyText()));
await page.screenshot({ path: `${OUT}/fs-cp-phone-misc-positions.png` });
await page.screenshot({ path: `${OUT}/fs-cp-phone-full.png`, fullPage: false });

check('No Back or Next in the panel', !(await layout()).back);

await page.evaluate(() => document.querySelector('[data-fs-cp="panel"] [aria-label="Close"]')?.click());
await new Promise((r) => setTimeout(r, 200));
const closed = await page.evaluate(() => ({
  panel: !!document.querySelector('[data-fs-cp="panel"]'),
  pills: [...document.querySelectorAll('[aria-label="Control panel"]')].length,
}));
check('Close hides the panel and shows one opener', !closed.panel && closed.pills === 1, JSON.stringify(closed));

await page.evaluate(() => document.querySelector('[aria-label="Control panel"]')?.click());
await new Promise((r) => setTimeout(r, 250));
rows = await tabLabels();
const legendNow = await page.evaluate(() => {
  // Reopen should restore Misc / Positions, not reset the legend setting.
  return {
    parents: [...document.querySelectorAll('[data-fs-cp="panel"] [role="tablist"]')][0]
      ? [...document.querySelectorAll('[data-fs-cp="panel"] [role="tab"]')].filter((b) => ['Contours', 'Readings', 'Misc'].includes((b.textContent || '').trim())).map((b) => ({ t: b.textContent.trim(), on: b.getAttribute('aria-selected') }))
      : [],
    child: document.querySelector('[data-fs-cp-section-body]')?.getAttribute('data-fs-cp-section-body'),
  };
});
check('Reopen returns to Misc / Positions', legendNow.child === 'positions' && legendNow.parents.find((p) => p.t === 'Misc')?.on === 'true', JSON.stringify(legendNow));

await clickTab('Contours');
await clickTab('Legend');
await new Promise((r) => setTimeout(r, 200));
const legendKept = await page.evaluate(() => {
  const body = document.querySelector('[data-fs-cp-section-body]');
  const switches = [...document.querySelectorAll('[data-fs-cp-section-body] [role="switch"]')].map((s) => ({
    checked: s.getAttribute('aria-checked'),
    label: (s.parentElement?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40),
  }));
  return { child: body?.getAttribute('data-fs-cp-section-body'), switches };
});
const legendSwitch = legendKept.switches?.find((s) => s.label === 'Legend');
check(
  'Tab changes and close do not reset the legend setting',
  legendSwitch?.checked === legendAfter,
  JSON.stringify(legendKept) + ' vs ' + legendAfter,
);

await page.setViewport({ width: 1024, height: 768, deviceScaleFactor: 2 });
await new Promise((r) => setTimeout(r, 600));
const ipadState = await page.evaluate(() => ({
  href: location.href,
  panel: !!document.querySelector('[data-fs-cp="panel"]'),
  pill: !!document.querySelector('[aria-label="Control panel"]'),
  text: (document.body.innerText || '').slice(0, 240),
}));
if (!ipadState.panel) {
  await page.evaluate(() => {
    const topo = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Topo');
    topo?.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => document.querySelector('[aria-label="Control panel"]')?.click());
  await new Promise((r) => setTimeout(r, 300));
}
await clickTab('Contours');
await clickTab('Legend');
lay = await layout();
check('iPad tabs stay inside the panel without overlap', lay.open && !lay.overlap && lay.tabs.every((t) => t.inPanel && !t.clipped), JSON.stringify({ panel: lay.panel, tabs: lay.tabs }));
await page.screenshot({ path: `${OUT}/fs-cp-ipad-contours.png` });
await clickTab('Misc');
await page.screenshot({ path: `${OUT}/fs-cp-ipad-misc.png` });
await page.screenshot({ path: `${OUT}/fs-cp-ipad-full.png` });

const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `FAILED ${failed.length}/${results.length}` : `ALL PASSED ${results.length}`);
await browser.close();
process.exit(failed.length ? 1 : 0);
