/**
 * Floor Survey correction parity checks (visual tokens + launch + core gestures).
 * Run: node tests/floor-survey-parity.mjs
 */
import { createRequire } from 'module';
import fs from 'fs';
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

async function seedFreshCf() {
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
    // Build a 400×300 white plan so field taps resolve to distinct image coords
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 300;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 400, 300);
    ctx.strokeStyle = '#333';
    ctx.strokeRect(20, 20, 360, 260);
    const planPng = c.toDataURL('image/png');
    const id = 'fs-parity-1';
    const canvasId = 'canvas-parity-1';
    const planId = 'plan-parity-1';
    await window.ToolboxDB.putMedia(planId, planPng);
    let rec = window.ToolboxApp.blankCustomerFile(id);
    window.ToolboxPlanSetup.ensurePlanSetup(rec);
    rec.firstName = 'Parity';
    rec.lastName = 'Tester';
    rec.propertyAddress = '200 Boundary Rd';
    rec.planSetup.canvases = [
      {
        id: canvasId,
        name: 'Main Level',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        plan: { id: planId, width: 400, height: 300 },
        rooms: [],
        frontDoorFacing: 'S',
        frontDoor: null,
      },
    ];
    rec.planSetup.activeCanvasId = canvasId;
    window.ToolboxPlanSetup.ensurePlanSetup(rec);
    window.ToolboxPlanSetup.ensureFloorSurveyCanvasRef(rec, canvasId);
    await window.ToolboxDB.saveCustomerFile(rec);
    return { id, canvasId };
  });
}

function isCssWhite(token) {
  if (!token) return false;
  const t = String(token).trim().toLowerCase().replace(/\s+/g, '');
  return (
    t === '#fff' ||
    t === '#ffffff' ||
    t === 'rgb(255,255,255)' ||
    t === 'rgba(255,255,255,1)' ||
    t === 'oklch(100%)' ||
    t === 'oklch(1 0 0)' ||
    t === 'oklch(1)' ||
    t.startsWith('lab(100%') ||
    t.startsWith('oklab(1') ||
    t.startsWith('color(srgb1')
  );
}

// ---- Launch: plan present, no boundary → Setup Topo boundary ----
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
const ids = await seedFreshCf();
await page.goto(BASE + `#/file/${ids.id}/floor`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1500));

const launch = await page.evaluate(() => {
  const tabs = [...document.querySelectorAll('button')].map((b) => b.textContent.trim());
  const active = [...document.querySelectorAll('button')].find((b) =>
    (b.className || '').includes('border-primary') && /Topo boundary|Details|Plan|Excluded/.test(b.textContent || ''),
  );
  const hint = (document.body.innerText || '').includes('Draw a topo boundary first');
  const hostDetails = (document.body.innerText || '').includes('Customer and plan come from the Customer File');
  const surveyDateWizard = (document.body.innerText || '').includes('1. Survey date');
  const provenSteps =
    (document.body.innerText || '').includes('1. Details') &&
    (document.body.innerText || '').includes('3. Topo boundary');
  const cs = getComputedStyle(document.querySelector('.floor-survey-host') || document.body);
  const bg = cs.backgroundColor;
  const rootBg = getComputedStyle(document.documentElement).getPropertyValue('--background').trim();
  const canvas = document.querySelector('canvas');
  return {
    activeTab: active?.textContent?.trim() || null,
    hint,
    hostDetails,
    surveyDateWizard,
    provenSteps,
    bg,
    rootBg,
    hasCanvas: !!canvas,
    textHead: (document.body.innerText || '').slice(0, 350),
    tabs: tabs.filter((t) => /Details|Plan|Topo|Excluded|Survey date/.test(t)),
  };
});

check('Launch lands on proven Setup (not invented Survey-date wizard)', !launch.surveyDateWizard && !launch.hostDetails, JSON.stringify({ surveyDateWizard: launch.surveyDateWizard, hostDetails: launch.hostDetails }));
check('Proven Setup step labels present', launch.provenSteps, launch.tabs.join(' | '));
check('Active step is Topo boundary', launch.activeTab === '3. Topo boundary', String(launch.activeTab));
check('Boundary-ready hint shown', launch.hint);
check('Plan canvas present for boundary drawing', launch.hasCanvas);
check(
  'CSS --background is white (#fff / oklch white)',
  isCssWhite(launch.rootBg) || isCssWhite(launch.bg),
  launch.rootBg || launch.bg,
);

await page.screenshot({ path: `${OUT}/fs_parity_launch_topo_boundary_desktop.png` });

// Click Plan step — must NOT offer upload when planLocked
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '2. Plan');
  btn?.click();
});
await new Promise((r) => setTimeout(r, 400));
const planStep = await page.evaluate(() => {
  const t = document.body.innerText || '';
  return {
    upload: /Upload plan|Replace plan/.test(t),
    addFloor: /Add floor/.test(t),
    fromCf: /Customer File/.test(t),
  };
});
check('Plan step does not offer upload/replace (CF owns plan)', !planStep.upload && !planStep.addFloor, JSON.stringify(planStep));
check('Plan step acknowledges Customer File plan', planStep.fromCf);

// Back to areas and draw a simple boundary via taps on canvas
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '3. Topo boundary');
  btn?.click();
});
await new Promise((r) => setTimeout(r, 400));

async function tapCanvas(nx, ny) {
  const box = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  if (!box) throw new Error('no canvas');
  const x = box.x + box.w * nx;
  const y = box.y + box.h * ny;
  await page.mouse.click(x, y);
  await new Promise((r) => setTimeout(r, 200));
}

// DrawingPanel typically: tap vertices, close shape
await tapCanvas(0.2, 0.2);
await tapCanvas(0.8, 0.2);
await tapCanvas(0.8, 0.8);
await tapCanvas(0.2, 0.8);
// close — often click first vertex again or Close button
const closedUi = await page.evaluate(() => {
  const closeBtn = [...document.querySelectorAll('button')].find((b) =>
    /^Close$|Close shape|Finish/i.test((b.textContent || '').trim()),
  );
  if (closeBtn) {
    closeBtn.click();
    return 'clicked-close';
  }
  return 'no-close-btn';
});
if (closedUi === 'no-close-btn') {
  await tapCanvas(0.2, 0.2); // close by returning to first point
}
await new Promise((r) => setTimeout(r, 600));

const afterBoundary = await page.evaluate(async (cfId, canvasId) => {
  const rec = await window.ToolboxDB.getCustomerFile(cfId);
  const layer = rec.floorSurvey.byCanvasId[canvasId];
  const areas = layer?.areas || [];
  const closed = areas.some((a) => (a.polygon || []).length >= 3);
  return {
    closed,
    areaCount: areas.length,
    polyLen: areas[0]?.polygon?.length || 0,
    boundaryLen: (layer?.boundary || []).length,
    layerHasPlan: !!layer?.planDataUrl,
  };
}, ids.id, ids.canvasId);
check(
  'Boundary create/close persists on FS layer (not plan bytes)',
  afterBoundary.closed && !afterBoundary.layerHasPlan,
  JSON.stringify(afterBoundary),
);
await page.screenshot({ path: `${OUT}/fs_parity_boundary_drawn_desktop.png` });

// Start surveying → Field
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    /Start surveying/i.test(b.textContent || ''),
  );
  btn?.click();
});
await new Promise((r) => setTimeout(r, 800));

// If still on excluded next step, advance
await page.evaluate(() => {
  const start = [...document.querySelectorAll('button')].find((b) => /Start surveying/i.test(b.textContent || ''));
  if (start) start.click();
  const next = [...document.querySelectorAll('button')].find((b) => /Next: Excluded|Next: Topo/i.test(b.textContent || ''));
  // Prefer start if available after next excluded skip — click Start when visible
});
await new Promise((r) => setTimeout(r, 500));
// Navigate via Next until Start surveying or Field controls appear
for (let i = 0; i < 3; i++) {
  const state = await page.evaluate(() => {
    const t = document.body.innerText || '';
    return {
      field: /Data/.test(t) && /Topo/.test(t),
      start: [...document.querySelectorAll('button')].some((b) => /Start surveying/i.test(b.textContent || '')),
      next: [...document.querySelectorAll('button')].find((b) => /^Next:/.test((b.textContent || '').trim()))?.textContent,
    };
  });
  if (state.field) break;
  if (state.start) {
    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find((b) => /Start surveying/i.test(b.textContent || ''))?.click();
    });
    await new Promise((r) => setTimeout(r, 600));
    break;
  }
  if (state.next) {
    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find((b) => /^Next:/.test((b.textContent || '').trim()))?.click();
    });
    await new Promise((r) => setTimeout(r, 400));
  }
}

const field = await page.evaluate(() => {
  const t = document.body.innerText || '';
  const cs = getComputedStyle(document.documentElement).getPropertyValue('--background').trim();
  return {
    hasDataTopo: /\bData\b/.test(t) && /\bTopo\b/.test(t),
    hasNotesOrKeypad: /Note|Data points|0/.test(t),
    rootBg: cs,
    textHead: t.slice(0, 250),
  };
});
check('Field mode shows Data/Topo controls', field.hasDataTopo, field.textHead.replace(/\n/g, ' | '));
await page.screenshot({ path: `${OUT}/fs_parity_field_desktop.png` });

// Place a base/reading via canvas tap → Set Base Point Continue → keypad confirm
await tapCanvas(0.45, 0.45);
await new Promise((r) => setTimeout(r, 400));
const bpPrompt = await page.evaluate(() => {
  const t = document.body.innerText || '';
  const has = /Set Base Point/.test(t);
  if (has) {
    [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Continue')?.click();
  }
  return has;
});
await new Promise((r) => setTimeout(r, 400));
const keypad = await page.evaluate(() => {
  const keys = [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim());
  const hasDigit = keys.includes('1') && keys.includes('9');
  // Default BP value is already 9.0 — confirm with lucide-check
  const withCheck = [...document.querySelectorAll('button')].find(
    (b) => b.innerHTML.includes('lucide-check') || b.querySelector('svg.lucide-check'),
  );
  withCheck?.click();
  return { hasDigit, confirmed: !!withCheck };
});
await new Promise((r) => setTimeout(r, 900));

const points = await page.evaluate(async (cfId, canvasId) => {
  const rec = await window.ToolboxDB.getCustomerFile(cfId);
  const layer = rec.floorSurvey.byCanvasId[canvasId];
  return {
    count: layer?.points?.length || 0,
    sample: layer?.points?.[0]
      ? { isBasePoint: !!layer.points[0].isBasePoint, value: layer.points[0].value, label: layer.points[0].label }
      : null,
  };
}, ids.id, ids.canvasId);
check(
  'Base/reference point placement persisted',
  points.count >= 1 && points.sample?.isBasePoint,
  JSON.stringify({ count: points.count, sample: points.sample, keypad, bpPrompt }),
);
await page.screenshot({ path: `${OUT}/fs_parity_point_placed_desktop.png` });

// Second sequential point — well away from BP1
await tapCanvas(0.3, 0.3);
await new Promise((r) => setTimeout(r, 500));
const seqKeypad = await page.evaluate(() => {
  const hasKeypad = [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === '7');
  // Proven path: Repeat last reading, or type a digit then Enter
  const repeat = [...document.querySelectorAll('button')].find((b) =>
    /Repeat/i.test(b.textContent || ''),
  );
  if (repeat) {
    repeat.click();
    return { hasKeypad, used: 'repeat' };
  }
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '8')?.click();
  [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Enter')?.click();
  return { hasKeypad, used: 'digit-enter' };
});
await new Promise((r) => setTimeout(r, 900));
const points2 = await page.evaluate(async (cfId, canvasId) => {
  const rec = await window.ToolboxDB.getCustomerFile(cfId);
  return rec.floorSurvey.byCanvasId[canvasId]?.points?.length || 0;
}, ids.id, ids.canvasId);
check(
  'Sequential point placement persisted',
  points2 >= 2,
  JSON.stringify({ count: points2, seqKeypad }),
);

// Undo
const beforeUndo = points2;
await page.evaluate(() => {
  const undo =
    document.querySelector('[aria-label*="Undo"]') ||
    [...document.querySelectorAll('button')].find((b) => b.innerHTML.includes('lucide-undo-2') || b.innerHTML.includes('lucide-undo'));
  undo?.click();
});
await new Promise((r) => setTimeout(r, 600));
const afterUndo = await page.evaluate(async (cfId, canvasId) => {
  const rec = await window.ToolboxDB.getCustomerFile(cfId);
  return rec.floorSurvey.byCanvasId[canvasId]?.points?.length || 0;
}, ids.id, ids.canvasId);
check('Undo across point operations', afterUndo < beforeUndo, `before=${beforeUndo} after=${afterUndo}`);

// Redo
await page.evaluate(() => {
  const redo =
    document.querySelector('[aria-label*="Redo"]') ||
    [...document.querySelectorAll('button')].find((b) => b.innerHTML.includes('lucide-redo'));
  redo?.click();
});
await new Promise((r) => setTimeout(r, 600));
const afterRedo = await page.evaluate(async (cfId, canvasId) => {
  const rec = await window.ToolboxDB.getCustomerFile(cfId);
  return rec.floorSurvey.byCanvasId[canvasId]?.points?.length || 0;
}, ids.id, ids.canvasId);
check('Redo restores point', afterRedo === beforeUndo, `beforeUndo=${beforeUndo} afterRedo=${afterRedo}`);

// Open Topo mode
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Topo')?.click();
});
await new Promise((r) => setTimeout(r, 800));
const topo = await page.evaluate(() => {
  const t = document.body.innerText || '';
  return {
    hasContoursOrControls: /Contour|Fill|Legend|Mesh|Topo/i.test(t),
    textHead: t.slice(0, 200),
  };
});
check('Topo mode opens with proven controls', topo.hasContoursOrControls, topo.textHead.replace(/\n/g, ' | '));
await page.screenshot({ path: `${OUT}/fs_parity_topo_desktop.png` });

// Back to Data, open Review via overflow if present
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Data')?.click();
});
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => {
  const more =
    document.querySelector('[aria-label*="More"]') ||
    [...document.querySelectorAll('button')].find((b) => b.innerHTML.includes('lucide-more-horizontal'));
  more?.click();
});
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => {
  [...document.querySelectorAll('button, [role=menuitem]')].find((b) => /Review/i.test(b.textContent || ''))?.click();
});
await new Promise((r) => setTimeout(r, 600));
const review = await page.evaluate(() => /Review|BP1|#|Elevation|Value/i.test(document.body.innerText || ''));
check('Review opens', review);
await page.screenshot({ path: `${OUT}/fs_parity_review_desktop.png` });

// Viewports: phone + iPad Mini — white chrome screenshots
for (const vp of [
  { name: 'iphone', width: 390, height: 844, dpr: 2, mobile: true },
  { name: 'ipad_mini', width: 768, height: 1024, dpr: 2, mobile: false },
  { name: 'desktop', width: 1280, height: 800, dpr: 1, mobile: false },
]) {
  await page.setViewport({
    width: vp.width,
    height: vp.height,
    deviceScaleFactor: vp.dpr,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
  });
  await page.goto(BASE + `#/file/${ids.id}/floor`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1200));
  const path = `${OUT}/fs_parity_field_${vp.name}.png`;
  await page.screenshot({ path });
  const token = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--background').trim(),
  );
  check(`Viewport ${vp.name}: white --background`, isCssWhite(token), token);
}

// Multi-level without corrupting data
await page.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 400;
  c.height = 300;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fafafa';
  ctx.fillRect(0, 0, 400, 300);
  const planPng = c.toDataURL('image/png');
  const rec = await window.ToolboxDB.getCustomerFile('fs-parity-1');
  await window.ToolboxDB.putMedia('plan-parity-2', planPng);
  rec.planSetup.canvases.push({
    id: 'canvas-parity-2',
    name: 'Upper Level',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    plan: { id: 'plan-parity-2', width: 400, height: 300 },
    rooms: [],
    frontDoorFacing: 'N',
    frontDoor: null,
  });
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  window.ToolboxPlanSetup.ensureFloorSurveyCanvasRef(rec, 'canvas-parity-2');
  await window.ToolboxDB.saveCustomerFile(rec);
});
await page.goto(BASE + `#/file/${ids.id}`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 400));
await page.goto(BASE + `#/file/${ids.id}/floor`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1500));
const multi = await page.evaluate(async () => {
  const sel = document.querySelector('[data-floor-selector] select');
  const before = (await window.ToolboxDB.getCustomerFile('fs-parity-1')).floorSurvey.byCanvasId['canvas-parity-1'];
  if (sel) {
    sel.value = 'canvas-parity-2';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
  await new Promise((r) => setTimeout(r, 500));
  if (sel) {
    sel.value = 'canvas-parity-1';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
  await new Promise((r) => setTimeout(r, 500));
  const after = (await window.ToolboxDB.getCustomerFile('fs-parity-1')).floorSurvey.byCanvasId['canvas-parity-1'];
  return {
    hasSwitcher: !!sel,
    areasBefore: before?.areas?.length || 0,
    areasAfter: after?.areas?.length || 0,
    pointsBefore: before?.points?.length || 0,
    pointsAfter: after?.points?.length || 0,
  };
});
check(
  'Switch levels and return without corrupting FS layer',
  multi.hasSwitcher && multi.areasBefore === multi.areasAfter,
  JSON.stringify(multi),
);
await page.screenshot({ path: `${OUT}/fs_parity_multi_level.png` });

// Sand token absence in loaded Floor Survey CSS (not Toolbox chrome tokens)
const cssCheck = await page.evaluate(async () => {
  const hrefs = [...document.querySelectorAll('link[rel=stylesheet]')].map((l) => l.href);
  let text = '';
  for (const h of hrefs) {
    if (!/floor-survey/.test(h)) continue;
    text += await (await fetch(h)).text();
  }
  return {
    sand: /0\.949 0\.012 82|f4f0e8|soft peach|warm sand|#fffaf0|#f3d8ce/.test(text),
    white: /--background:#fff|--background: #fff|--background:oklch\(1 0 0\)/.test(text.replace(/\s/g, '')),
  };
});
check('Bundled FS CSS has no sand/peach tokens', !cssCheck.sand, JSON.stringify(cssCheck));
check('Bundled FS CSS has white background token', cssCheck.white, JSON.stringify(cssCheck));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
fs.writeFileSync(`${OUT}/fs_parity_results.json`, JSON.stringify(results, null, 2));
if (failed.length) process.exitCode = 1;
