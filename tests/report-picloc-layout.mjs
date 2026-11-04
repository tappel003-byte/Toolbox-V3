/**
 * Picture Locations: tight plan frame (no tall letterbox), pin pad for
 * off-plan pins, independent move/resize, save/reopen, Present/PDF parity.
 * Run: node tests/report-picloc-layout.mjs
 */
import { createRequire } from 'module';
import { mkdir, writeFile, readFile } from 'fs/promises';

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('/tmp/node_modules/puppeteer-core');
}

const BASE = 'http://127.0.0.1:8765/index.html';
const OUT = '/opt/cursor/artifacts';
const FILE = 'rb-picloc-layout';
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
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });

await page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('toolbox', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['customerFiles', 'media'], 'readwrite');
    tx.objectStore('customerFiles').clear();
    tx.objectStore('media').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
});

// Unit: tightPlanBox + pad; resolveLayout leaves custom alone
const unit = await page.evaluate(() => {
  const api = window.ToolboxPenLog;
  const max = api.LAYOUT.plan;
  const tight = api.tightPlanBox(max, 1600, 900);
  const custom = api.resolveLayout({
    plan: { x: 1, y: 1, w: 6, h: 6 },
    schedule: { x: 9, y: 1, w: 4, h: 8 },
  }, 1600, 900);
  const def = api.resolveLayout(null, 1600, 900);
  return {
    tightH: tight.h,
    maxH: max.h,
    tightW: tight.w,
    padOk: tight.h < max.h - 1 && tight.h > (1600 > 0 ? (max.w * 900 / 1600) : 0),
    customKept: Math.abs(custom.plan.w - 6) < 0.01 && Math.abs(custom.plan.h - 6) < 0.01,
    defTight: def.plan.h < max.h - 1,
  };
});
check('tightPlanBox shrinks tall default slot to plan aspect (+ pin pad)',
  unit.tightH < unit.maxH - 1 && unit.defTight && unit.customKept,
  JSON.stringify(unit));

// Seed CF: wide plan with substantial container white potential + off-plan pin
await page.evaluate(async (id) => {
  const c = document.createElement('canvas');
  c.width = 1600;
  c.height = 900;
  const x = c.getContext('2d');
  // Edge-to-edge drawing — no ambiguous bitmap margins.
  x.fillStyle = '#e8e4dc';
  x.fillRect(0, 0, 1600, 900);
  x.strokeStyle = '#222';
  x.lineWidth = 8;
  x.strokeRect(40, 40, 1520, 820);
  x.fillStyle = '#8B5E3C';
  x.fillRect(200, 200, 400, 300);
  const plan = c.toDataURL('image/jpeg', 0.9);

  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Pic';
  rec.lastName = 'Loc';
  rec.propertyAddress = '7 Picture Locations Ln';
  const cv = rec.planSetup.canvases[0];
  cv.name = 'Main Level';
  await window.ToolboxDB.putMedia('plan-picloc', plan);
  cv.plan = { id: 'plan-picloc', width: 1600, height: 900 };
  rec.distress = {
    updatedAt: '2026-10-09T12:00:00.000Z',
    activeCanvasId: cv.id,
    pins: [
      {
        id: 'pin-in', canvasId: cv.id, x: 0.35, y: 0.4,
        description: 'Crack at corner', photos: ['ph1'],
      },
      {
        id: 'pin-out', canvasId: cv.id, x: 0.95, y: 0.1,
        description: 'Exterior entry', photos: ['ph2'], exterior: true,
        // Report offset pulls the marker just outside the plan image.
      },
      {
        id: 'pin-far', canvasId: cv.id, x: 0.5, y: 0.5,
        description: 'Stacked photo pulled aside', photos: ['ph3'],
      },
    ],
  };
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet:not(.rb-sheet--thumb)'), { timeout: 40000 });
await page.evaluate(() => {
  const thumb = [...document.querySelectorAll('.rb-thumb')]
    .find((t) => /^distress-/.test(t.getAttribute('data-page-id') || ''));
  thumb?.click();
});
await new Promise((r) => setTimeout(r, 2500));

const before = await page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
  const plan = sheet.querySelector('.rb-penlog__plan');
  const fit = sheet.querySelector('.rb-penlog__fit');
  const schedule = sheet.querySelector('.rb-penlog__schedule');
  const sheetR = sheet.getBoundingClientRect();
  const planR = plan.getBoundingClientRect();
  const fitR = fit.getBoundingClientRect();
  const pins = [...sheet.querySelectorAll('.rb-penlog__pin')].map((p) => {
    const r = p.getBoundingClientRect();
    return {
      id: p.getAttribute('data-pin-id'),
      cx: r.left + r.width / 2,
      cy: r.top + r.height / 2,
      text: p.textContent,
    };
  });
  // Apply an off-plan offset on pin-far via the live page model by dragging
  // is hard here — set style offset through reportBuilder pinOffsets if present.
  return {
    planInches: {
      x: (planR.left - sheetR.left) / sheetR.width * 17,
      y: (planR.top - sheetR.top) / sheetR.height * 11,
      w: planR.width / sheetR.width * 17,
      h: planR.height / sheetR.height * 11,
    },
    fitTopGap: fitR.top - planR.top,
    fitBottomGap: planR.bottom - fitR.bottom,
    fitLeftGap: fitR.left - planR.left,
    fitRightGap: planR.right - fitR.right,
    scheduleX: (schedule.getBoundingClientRect().left - sheetR.left) / sheetR.width * 17,
    pinCount: pins.length,
    pinNums: pins.map((p) => p.text).join(','),
    overflow: getComputedStyle(plan).overflow,
    handlesInEditor: sheet.querySelectorAll('.rb-penlog__resize').length,
  };
});

check('default plan box is aspect-tight (not the old tall letterbox)',
  before.planInches.h < 7.5 && before.fitTopGap < 45 && before.fitBottomGap < 45,
  JSON.stringify(before));
check('plan overflow stays visible for off-plan pins',
  before.overflow === 'visible', before.overflow);
check('pins and numbering present',
  before.pinCount >= 3 && before.pinNums.length > 0, JSON.stringify(before));

await page.screenshot({ path: `${OUT}/rb-picloc-before-adjust.png`, fullPage: true });

// Apply off-plan pin offset via saved report offsets, then reopen
await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const pages = rec.reportBuilder.pages || [];
  const pl = pages.find((p) => p.type === 'distress' && p.meta?.penLog);
  if (pl) {
    pl.reportText = pl.reportText || {};
    pl.reportText.pinOffsets = pl.reportText.pinOffsets || {};
    // Percent of plan rect — pushes marker outside the image.
    pl.reportText.pinOffsets['pin-far'] = { dx: 12, dy: -14 };
  }
  await window.ToolboxDB.saveCustomerFile(rec);
}, FILE);

await page.goto(`${BASE}#/file/${FILE}`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 600));
await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet:not(.rb-sheet--thumb)'), { timeout: 40000 });
await page.evaluate(() => {
  const thumb = [...document.querySelectorAll('.rb-thumb')]
    .find((t) => /^distress-/.test(t.getAttribute('data-page-id') || ''));
  thumb?.click();
});
await new Promise((r) => setTimeout(r, 2500));

const offPlan = await page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
  const fit = sheet.querySelector('.rb-penlog__fit').getBoundingClientRect();
  const pin = sheet.querySelector('.rb-penlog__pin[data-pin-id="pin-far"]');
  if (!pin) return { ok: false };
  const r = pin.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const outside = cx > fit.right + 2 || cy < fit.top - 2 || cx < fit.left - 2 || cy > fit.bottom + 2;
  const visible = r.width > 0 && getComputedStyle(pin).visibility !== 'hidden';
  return { outside, visible, cx, cy, fit: { t: fit.top, r: fit.right, b: fit.bottom, l: fit.left } };
});
check('off-plan pin offset remains visible outside the fitted image',
  offPlan.outside === true && offPlan.visible === true, JSON.stringify(offPlan));

async function dragPenBody(which, dx, dy) {
  // Floor Survey rule: body click-drag moves the piece. Pick first, then
  // drag from a quiet spot inside the box (not a pin, not a corner grip).
  const start = await page.evaluate((id) => {
    const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
    const box = sheet.querySelector(`[data-rb-penlog-box="${id}"]`);
    if (!box) return null;
    box.classList.add('is-picked');
    box.focus?.();
    const r = box.getBoundingClientRect();
    return { x: r.left + Math.min(48, r.width * 0.15), y: r.top + Math.min(48, r.height * 0.15) };
  }, which);
  if (!start) throw new Error('box missing: ' + which);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 14 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 1600));
}

async function dragPenCorner(which, corner, dx, dy) {
  // Pick via a real click so :focus-within also lights the brackets, then
  // drag from the inward side of the corner handle (more reliable than the
  // geometric centre when the bracket straddles the box edge).
  const pick = await page.evaluate((id) => {
    const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
    const box = sheet.querySelector(`[data-rb-penlog-box="${id}"]`);
    if (!box) return null;
    const r = box.getBoundingClientRect();
    return { x: r.left + Math.min(48, r.width * 0.15), y: r.top + Math.min(48, r.height * 0.15) };
  }, which);
  if (!pick) throw new Error('box missing: ' + which);
  await page.mouse.click(pick.x, pick.y);
  await new Promise((r) => setTimeout(r, 250));
  const start = await page.evaluate((id, c) => {
    const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
    const box = sheet.querySelector(`[data-rb-penlog-box="${id}"]`);
    const g = box && box.querySelector(`[data-rb-penlog-resize="${id}"][data-rb-penlog-corner="${c}"]`);
    if (!g) return null;
    const r = g.getBoundingClientRect();
    const inset = {
      nw: { x: r.right - 4, y: r.bottom - 4 },
      ne: { x: r.left + 4, y: r.bottom - 4 },
      sw: { x: r.right - 4, y: r.top + 4 },
      se: { x: r.left + 4, y: r.top + 4 },
    }[c] || { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    return { x: inset.x, y: inset.y, shown: getComputedStyle(g).display };
  }, which, corner);
  if (!start || start.shown === 'none') throw new Error('corner not shown: ' + which + '/' + corner);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 14 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 1600));
}

function boxes() {
  return page.evaluate(() => {
    const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
    const s = sheet.getBoundingClientRect();
    function inch(el) {
      const r = el.getBoundingClientRect();
      return {
        x: (r.left - s.left) / s.width * 17,
        y: (r.top - s.top) / s.height * 11,
        w: r.width / s.width * 17,
        h: r.height / s.height * 11,
      };
    }
    return {
      plan: inch(sheet.querySelector('.rb-penlog__plan')),
      schedule: inch(sheet.querySelector('.rb-penlog__schedule')),
    };
  });
}

const start = await boxes();
await dragPenBody('plan', 70, 50);
const movedPlan = await boxes();
check('body-dragging the plan leaves the notes table put',
  movedPlan.plan.x > start.plan.x + 0.25 && movedPlan.plan.y > start.plan.y + 0.2 &&
  Math.abs(movedPlan.schedule.x - start.schedule.x) < 0.15,
  JSON.stringify({ start, movedPlan }));

await dragPenCorner('schedule', 'se', 80, -50);
const sizedNotes = await boxes();
check('corner-resizing the notes leaves the plan put',
  sizedNotes.schedule.w > movedPlan.schedule.w + 0.4 &&
  sizedNotes.schedule.h < movedPlan.schedule.h - 0.25 &&
  Math.abs(sizedNotes.plan.x - movedPlan.plan.x) < 0.15 &&
  Math.abs(sizedNotes.plan.w - movedPlan.plan.w) < 0.2,
  JSON.stringify({ movedPlan, sizedNotes }));

// Bring plan in front of notes, then send it back — Floor Survey stack menu.
const zBefore = await page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
  const plan = sheet.querySelector('[data-rb-penlog-box="plan"]');
  const schedule = sheet.querySelector('[data-rb-penlog-box="schedule"]');
  return {
    planZ: Number(getComputedStyle(plan).zIndex) || 0,
    scheduleZ: Number(getComputedStyle(schedule).zIndex) || 0,
  };
});
await page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
  const plan = sheet.querySelector('[data-rb-penlog-box="plan"]');
  const r = plan.getBoundingClientRect();
  plan.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true,
    clientX: r.left + 40, clientY: r.top + 40,
  }));
});
await new Promise((r) => setTimeout(r, 200));
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.rb-stackmenu__item')]
    .find((el) => /Bring to front/i.test(el.textContent || ''));
  btn?.click();
});
await new Promise((r) => setTimeout(r, 1200));
const zFront = await page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
  const plan = sheet.querySelector('[data-rb-penlog-box="plan"]');
  const schedule = sheet.querySelector('[data-rb-penlog-box="schedule"]');
  return {
    planZ: Number(getComputedStyle(plan).zIndex) || 0,
    scheduleZ: Number(getComputedStyle(schedule).zIndex) || 0,
  };
});
check('Bring to front stacks the plan above the notes',
  zFront.planZ > zFront.scheduleZ && zFront.planZ > zBefore.planZ,
  JSON.stringify({ zBefore, zFront }));

await page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
  const plan = sheet.querySelector('[data-rb-penlog-box="plan"]');
  const r = plan.getBoundingClientRect();
  plan.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true,
    clientX: r.left + 40, clientY: r.top + 40,
  }));
});
await new Promise((r) => setTimeout(r, 200));
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.rb-stackmenu__item')]
    .find((el) => /Send to back/i.test(el.textContent || ''));
  btn?.click();
});
await new Promise((r) => setTimeout(r, 1200));
const zBack = await page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
  const plan = sheet.querySelector('[data-rb-penlog-box="plan"]');
  const schedule = sheet.querySelector('[data-rb-penlog-box="schedule"]');
  return {
    planZ: Number(getComputedStyle(plan).zIndex) || 0,
    scheduleZ: Number(getComputedStyle(schedule).zIndex) || 0,
    storedZ: null,
  };
});
check('Send to back stacks the plan behind the notes',
  zBack.planZ < zBack.scheduleZ,
  JSON.stringify({ zFront, zBack }));

await page.waitForFunction(
  () => /^Saved/.test(document.querySelector('#rb-save-status')?.textContent || ''),
  { timeout: 15000 });

const stored = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  return (rec.reportBuilder || {}).penLogLayout || null;
}, FILE);
check('geometry persisted on reportBuilder.penLogLayout',
  !!stored && Math.abs(stored.schedule.w - sizedNotes.schedule.w) < 0.35,
  JSON.stringify(stored));

await page.screenshot({ path: `${OUT}/rb-picloc-after-adjust.png`, fullPage: true });

// Reopen
await page.goto(`${BASE}#/`, { waitUntil: 'networkidle0' });
await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet:not(.rb-sheet--thumb)'), { timeout: 40000 });
await page.evaluate(() => {
  const thumb = [...document.querySelectorAll('.rb-thumb')]
    .find((t) => /^distress-/.test(t.getAttribute('data-page-id') || ''));
  thumb?.click();
});
await new Promise((r) => setTimeout(r, 2500));
const reopened = await boxes();
check('save/reopen restores plan and notes geometry',
  Math.abs(reopened.plan.x - sizedNotes.plan.x) < 0.35 &&
  Math.abs(reopened.schedule.w - sizedNotes.schedule.w) < 0.35,
  JSON.stringify({ sizedNotes, reopened }));

const pinAfter = await page.evaluate(() => {
  const sheet = document.querySelector('.rb-sheet:not(.rb-sheet--thumb)');
  const notes = [...sheet.querySelectorAll('.rb-penlog__note, .rb-penlog__note--print')]
    .map((n) => (n.value || n.textContent || '').trim()).filter(Boolean);
  const nums = [...sheet.querySelectorAll('.rb-penlog__pin')].map((p) => p.textContent);
  const scheduleText = sheet.querySelector('.rb-penlog__schedule')?.innerText || '';
  return { nums, scheduleText: scheduleText.slice(0, 200), noteLike: /Crack|Exterior|Stacked|Photo/i.test(scheduleText) };
});
check('notes remain readable and pin numbers intact after resize/reopen',
  pinAfter.nums.length >= 3 && pinAfter.noteLike, JSON.stringify(pinAfter));

// Present + PDF
const present = await page.evaluate(async () => {
  document.querySelector('#rb-present')?.click();
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 400));
    if (document.body.classList.contains('is-presenting')) break;
  }
  if (!document.body.classList.contains('is-presenting')) {
    return { presenting: false, status: document.querySelector('#rb-save-status')?.textContent || '' };
  }
  const deck = document.querySelector('.rb-print');
  const sheets = [...(deck?.querySelectorAll('.rb-sheet') || [])];
  const penIdx = sheets.findIndex((s) => s.querySelector('.rb-penlog'));
  const next = document.querySelector('[data-present="next"]');
  for (let i = 0; i < penIdx; i += 1) next?.click();
  await new Promise((r) => setTimeout(r, 300));
  const sheet = sheets[penIdx];
  if (!sheet) return { presenting: true, noPenLog: true };
  const planEl = sheet.querySelector('.rb-penlog__plan');
  const scheduleEl = sheet.querySelector('.rb-penlog__schedule');
  const handles = sheet.querySelectorAll('.rb-penlog__resize').length;
  // Percent styles are the saved geometry (stable under Present scaling).
  function pct(el, prop) {
    const v = el && el.style && el.style[prop];
    return v ? parseFloat(v) : null;
  }
  return {
    presenting: true,
    handles,
    planPct: { left: pct(planEl, 'left'), top: pct(planEl, 'top'), width: pct(planEl, 'width'), height: pct(planEl, 'height') },
    schedulePct: { left: pct(scheduleEl, 'left'), width: pct(scheduleEl, 'width'), height: pct(scheduleEl, 'height') },
    stored: (await window.ToolboxDB.getCustomerFile('rb-picloc-layout')).reportBuilder?.penLogLayout || null,
  };
});

function pctOfIn(inches, total) {
  return (inches / total) * 100;
}
check('Present uses saved geometry without selection handles',
  present.presenting && present.handles === 0 && present.planPct &&
  (present.stored
    ? Math.abs(present.planPct.left - pctOfIn(present.stored.plan.x, 17)) < 1.5 &&
      Math.abs(present.schedulePct.width - pctOfIn(present.stored.schedule.w, 17)) < 1.5
    : Math.abs(present.planPct.height - pctOfIn(reopened.plan.h, 11)) < 2),
  JSON.stringify(present));

await page.screenshot({ path: `${OUT}/rb-picloc-present.png`, fullPage: true });

let pdfBytes = 0;
if (present.presenting) {
  const pdf = await page.pdf({
    path: `${OUT}/rb-picloc-layout.pdf`,
    printBackground: true,
    landscape: true,
    width: '17in',
    height: '11in',
  });
  pdfBytes = pdf?.length || (await readFile(`${OUT}/rb-picloc-layout.pdf`)).length;
  check('generated PDF artifact', pdfBytes > 15000, `bytes=${pdfBytes}`);
  await page.evaluate(() => document.querySelector('[data-present="close"]')?.click());
  await new Promise((r) => setTimeout(r, 400));
} else {
  check('generated PDF artifact', false, 'Present did not open');
}

// Narrow viewport
await page.setViewport({ width: 900, height: 700, deviceScaleFactor: 1 });
await page.goto(`${BASE}#/file/${FILE}/report`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!document.querySelector('.rb-sheet:not(.rb-sheet--thumb)'), { timeout: 40000 });
await page.evaluate(() => {
  const thumb = [...document.querySelectorAll('.rb-thumb')]
    .find((t) => /^distress-/.test(t.getAttribute('data-page-id') || ''));
  thumb?.click();
});
await new Promise((r) => setTimeout(r, 2000));
const narrow = await boxes();
check('narrow viewport keeps saved geometry proportions',
  Math.abs(narrow.plan.x - reopened.plan.x) < 0.5 &&
  Math.abs(narrow.schedule.w - reopened.schedule.w) < 0.5,
  JSON.stringify({ reopened, narrow }));
await page.screenshot({ path: `${OUT}/rb-picloc-narrow.png`, fullPage: true });

// Compatibility: report with saved tall legacy penLogLayout keeps it
const compat = await page.evaluate(() => {
  const api = window.ToolboxPenLog;
  const legacy = {
    plan: { x: 0.4, y: 0.45, w: 8.1, h: 10.1 },
    schedule: { x: 8.8, y: 0.45, w: 5.5, h: 10.1 },
  };
  const resolved = api.resolveLayout(legacy, 1600, 900);
  return {
    kept: Math.abs(resolved.plan.h - 10.1) < 0.02,
    h: resolved.plan.h,
  };
});
check('existing saved tall penLogLayout is not auto-rewritten',
  compat.kept, JSON.stringify(compat));

await writeFile(`${OUT}/rb-picloc-layout-results.json`, JSON.stringify({
  dumpedAt: new Date().toISOString(),
  unit, before, offPlan, start, movedPlan, sizedNotes, zBefore, zFront, zBack,
  stored, reopened, present, pdfBytes, narrow, compat, results,
}, null, 2));

console.log('\nWrote', `${OUT}/rb-picloc-layout-results.json`);
console.log('Summary:', results.filter((r) => r.ok).length, 'pass /', results.length, 'total');
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
