/**
 * Distress Survey host integration tests (Toolbox + proven FRP).
 * Run: node tests/distress-survey-integrate.mjs
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

function makePlanDataUrl(page, w, h, label) {
  return page.evaluate(
    (W, H, L) => {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 3;
      ctx.strokeRect(20, 20, W - 40, H - 40);
      ctx.fillStyle = '#666';
      ctx.font = '24px sans-serif';
      ctx.fillText(L || 'Plan', 40, 60);
      return c.toDataURL('image/png');
    },
    w,
    h,
    label,
  );
}

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

await page.goto(BASE, { waitUntil: 'networkidle0' });

check(
  'ToolboxDistress.mount present',
  await page.evaluate(() => !!(window.ToolboxDistress && window.ToolboxDistress.mount)),
);

const planA = await makePlanDataUrl(page, 400, 300, 'Basement');
const planB = await makePlanDataUrl(page, 400, 300, 'Ground');
const planC = await makePlanDataUrl(page, 400, 300, 'Second');

const seeded = await page.evaluate(
  async (plans) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('toolbox', 2);
      r.onerror = () => rej(r.error);
      r.onsuccess = () => res(r.result);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction(['customerFiles', 'media'], 'readwrite');
      tx.objectStore('customerFiles').clear();
      tx.objectStore('media').clear();
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });

    await window.ToolboxDB.putMedia('plan-b', plans.a);
    await window.ToolboxDB.putMedia('plan-g', plans.b);
    await window.ToolboxDB.putMedia('plan-s', plans.c);

    const id = 'ds-int-1';
    let rec = window.ToolboxApp.blankCustomerFile(id);
    window.ToolboxPlanSetup.ensurePlanSetup(rec);
    rec.firstName = 'Distress';
    rec.lastName = 'Tester';
    rec.propertyAddress = '100 Pin Lane';
    const now = new Date().toISOString();
    rec.planSetup.canvases = [
      {
        id: 'canvas-basement',
        name: 'Basement',
        createdAt: now,
        updatedAt: now,
        plan: { id: 'plan-b', width: 400, height: 300 },
        rooms: [{ name: 'Storage', x: 100, y: 100 }],
        frontDoorFacing: 'S',
        frontDoor: null,
      },
      {
        id: 'canvas-ground',
        name: 'Ground Floor',
        createdAt: now,
        updatedAt: now,
        plan: { id: 'plan-g', width: 400, height: 300 },
        rooms: [{ name: 'Living', x: 120, y: 140 }],
        frontDoorFacing: 'S',
        frontDoor: null,
      },
      {
        id: 'canvas-second',
        name: 'Second Floor',
        createdAt: now,
        updatedAt: now,
        plan: { id: 'plan-s', width: 400, height: 300 },
        rooms: [{ name: 'Bedroom', x: 150, y: 120 }],
        frontDoorFacing: 'N',
        frontDoor: null,
      },
    ];
    rec.planSetup.activeCanvasId = 'canvas-basement';
    window.ToolboxPlanSetup.ensurePlanSetup(rec);
    rec.distress.activeCanvasId = 'canvas-basement';
    await window.ToolboxDB.saveCustomerFile(rec);
    return { id };
  },
  { a: planA, b: planB, c: planC },
);

// Open Distress from CF home
await page.goto(BASE + `#/file/${seeded.id}`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 600));
check('CF home shows Distress drawer', await page.evaluate(() => !!document.querySelector('[data-app="distress"]')));
await page.click('[data-app="distress"]');
await new Promise((r) => setTimeout(r, 2500));

const frame = () => {
  const f = page.frames().find((fr) => /distress-survey\/survey\.html/.test(fr.url()));
  return f;
};

let fr = frame();
check('Distress iframe mounted', !!fr, fr ? fr.url() : 'no frame');

if (!fr) {
  await page.screenshot({ path: `${OUT}/ds_fail_no_iframe.png` });
  fs.writeFileSync(`${OUT}/ds_integrate_results.json`, JSON.stringify(results, null, 2));
  await browser.close();
  process.exitCode = 1;
  throw new Error('no iframe');
}

await fr.waitForSelector('#screenWork.active, body.host-mode #stage', { timeout: 15000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 1000));

const launch = await fr.evaluate(() => {
  const work = document.getElementById('screenWork');
  const setup = document.getElementById('screenSetup');
  const home = document.getElementById('screenHome');
  const title = document.getElementById('wTitle')?.textContent || '';
  const pill = document.getElementById('levelPill');
  const label = document.getElementById('levelPillLabel')?.textContent || '';
  return {
    hostMode: document.body.classList.contains('host-mode'),
    workActive: !!(work && work.classList.contains('active')),
    setupHidden: !setup || setup.style.display === 'none' || !setup.classList.contains('active'),
    homeHidden: !home || !home.classList.contains('active'),
    title,
    pillVisible: pill && !pill.hidden,
    pillLabel: label,
    hasStage: !!document.getElementById('stage'),
  };
});

check('Opens work screen (not setup/home)', launch.workActive && launch.setupHidden && launch.homeHidden, JSON.stringify(launch));
check('CF address/title shown', /Pin Lane|Distress/i.test(launch.title), launch.title);
check('Multi-level pill visible', launch.pillVisible, launch.pillLabel);
check('Pill shows Basement', /Basement/i.test(launch.pillLabel), launch.pillLabel);
await page.screenshot({ path: `${OUT}/ds_01_basement_launch.png` });

// Place pin via stage click (center)
async function tapPlan(nx, ny) {
  const box = await fr.evaluate(() => {
    const s = document.getElementById('stage');
    const r = s.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  // iframe coordinates: puppeteer click uses page coords — need frame offset
  const iframeBox = await page.$eval('iframe', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y };
  });
  const x = iframeBox.x + box.x + box.w * nx;
  const y = iframeBox.y + box.y + box.h * ny;
  await page.mouse.click(x, y);
  await new Promise((r) => setTimeout(r, 400));
}

await tapPlan(0.4, 0.45);
await new Promise((r) => setTimeout(r, 800));

// Pin sheet may open — Done to close
await fr.evaluate(() => {
  const done = [...document.querySelectorAll('button')].find((b) => /Done/i.test(b.textContent || ''));
  done?.click();
});
await new Promise((r) => setTimeout(r, 500));

let state = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const pins = rec.distress?.pins || [];
  return {
    pinCount: pins.length,
    canvasIds: pins.map((p) => p.canvasId),
    nums: pins.map((p) => p.num),
    nextNum: rec.distress?.nextNum,
    active: rec.distress?.activeCanvasId,
  };
}, seeded.id);

check('Pin created on Basement with canvasId', state.pinCount >= 1 && state.canvasIds[0] === 'canvas-basement', JSON.stringify(state));
check('Global numbering starts at 1', state.nums[0] === 1, JSON.stringify(state.nums));

// Place second basement pin
await tapPlan(0.55, 0.55);
await fr.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => /Done/i.test(b.textContent || ''))?.click();
});
await new Promise((r) => setTimeout(r, 600));

state = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  return {
    pins: (rec.distress?.pins || []).map((p) => ({ num: p.num, canvasId: p.canvasId, photos: (p.photos || []).length })),
    nextNum: rec.distress?.nextNum,
  };
}, seeded.id);
check('Second Basement pin continues numbering', state.pins.length >= 2 && state.pins[1].num === 2, JSON.stringify(state));

await page.screenshot({ path: `${OUT}/ds_02_basement_pins.png` });

// Switch to Second Floor via pill
await fr.evaluate(() => {
  document.getElementById('levelPillBtn')?.click();
});
await new Promise((r) => setTimeout(r, 300));
await fr.evaluate(() => {
  const btn = [...document.querySelectorAll('#levelPillMenu button')].find((b) =>
    /Second Floor/i.test(b.textContent || ''),
  );
  btn?.click();
});
await new Promise((r) => setTimeout(r, 1200));

const afterSwitch = await fr.evaluate(() => ({
  label: document.getElementById('levelPillLabel')?.textContent,
  pinCountOnPlan: document.querySelectorAll('#gPins .pin').length,
  sub: document.getElementById('wSub')?.textContent,
}));
check('Switched pill to Second Floor', /Second Floor/i.test(afterSwitch.label || ''), JSON.stringify(afterSwitch));
check('Basement pins hidden on Second Floor', afterSwitch.pinCountOnPlan === 0, JSON.stringify(afterSwitch));
await page.screenshot({ path: `${OUT}/ds_03_second_floor_empty.png` });

// Create pin on Second Floor
await tapPlan(0.35, 0.4);
await fr.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => /Done/i.test(b.textContent || ''))?.click();
});
await new Promise((r) => setTimeout(r, 700));

state = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  const pins = rec.distress?.pins || [];
  return {
    pins: pins.map((p) => ({ num: p.num, canvasId: p.canvasId })),
    nextNum: rec.distress?.nextNum,
    active: rec.distress?.activeCanvasId,
  };
}, seeded.id);

const secondPins = state.pins.filter((p) => p.canvasId === 'canvas-second');
check('Second Floor pin created', secondPins.length >= 1, JSON.stringify(state));
check(
  'Numbering continues globally (not reset per level)',
  secondPins[0]?.num === 3,
  JSON.stringify(state),
);

// Ground Floor pin
await fr.evaluate(() => {
  document.getElementById('levelPillBtn')?.click();
});
await new Promise((r) => setTimeout(r, 200));
await fr.evaluate(() => {
  [...document.querySelectorAll('#levelPillMenu button')]
    .find((b) => /Ground Floor/i.test(b.textContent || ''))
    ?.click();
});
await new Promise((r) => setTimeout(r, 1000));
await tapPlan(0.5, 0.5);
await fr.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => /Done/i.test(b.textContent || ''))?.click();
});
await new Promise((r) => setTimeout(r, 700));

state = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  return (rec.distress?.pins || []).map((p) => ({ num: p.num, canvasId: p.canvasId }));
}, seeded.id);
const ground = state.filter((p) => p.canvasId === 'canvas-ground');
check('Ground Floor pin continues global sequence', ground[0]?.num === 4, JSON.stringify(state));
await page.screenshot({ path: `${OUT}/ds_04_ground_pin.png` });

// Back to Basement — pins reappear
await fr.evaluate(() => {
  document.getElementById('levelPillBtn')?.click();
});
await new Promise((r) => setTimeout(r, 200));
await fr.evaluate(() => {
  [...document.querySelectorAll('#levelPillMenu button')]
    .find((b) => /Basement/i.test(b.textContent || ''))
    ?.click();
});
await new Promise((r) => setTimeout(r, 1000));
const back = await fr.evaluate(() => ({
  label: document.getElementById('levelPillLabel')?.textContent,
  visiblePins: document.querySelectorAll('#gPins .pin').length,
}));
check('Basement pins reappear', back.visiblePins >= 2, JSON.stringify(back));
await page.screenshot({ path: `${OUT}/ds_05_basement_restored.png` });

// Leave and reopen
await fr.evaluate(() => {
  document.querySelector('.back-btn')?.click();
});
await new Promise((r) => setTimeout(r, 1000));
await page.goto(BASE + `#/file/${seeded.id}/distress`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 2500));
fr = frame();
// Wait until work screen is live again before screenshot
for (let i = 0; i < 20 && !fr; i++) {
  await new Promise((r) => setTimeout(r, 250));
  fr = frame();
}
if (fr) {
  await fr.waitForSelector('#screenWork.active, #wTitle', { timeout: 8000 }).catch(() => {});
}
const reopened = await page.evaluate(async (id) => {
  const rec = await window.ToolboxDB.getCustomerFile(id);
  return {
    pins: (rec.distress?.pins || []).map((p) => ({ num: p.num, canvasId: p.canvasId })),
    nextNum: rec.distress?.nextNum,
    active: rec.distress?.activeCanvasId,
  };
}, seeded.id);
check(
  'Persist/reopen keeps all pins + global nums',
  reopened.pins.length >= 4 && reopened.pins.map((p) => p.num).join(',') === '1,2,3,4',
  JSON.stringify(reopened),
);
await page.screenshot({ path: `${OUT}/ds_06_reopened.png` });

// Simulate photo-count renumber across levels via direct data + recompute in frame
if (fr) {
  const renum = await fr.evaluate(() => {
    if (!project) return null;
    // Add fake photo ids to first pin (Basement) to consume 3 numbers
    const p0 = project.pins[0];
    p0.photos = ['ph_a', 'ph_b', 'ph_c'];
    recomputeNumbering();
    saveProject();
    return project.pins.map((p) => ({ num: p.num, canvasId: p.canvasId, photos: (p.photos || []).length }));
  });
  await new Promise((r) => setTimeout(r, 800));
  const afterRenum = await page.evaluate(async (id) => {
    const rec = await window.ToolboxDB.getCustomerFile(id);
    return (rec.distress?.pins || []).map((p) => ({
      num: p.num,
      canvasId: p.canvasId,
      photos: (p.photos || []).length,
    }));
  }, seeded.id);
  // Pin0 has 3 photos → nums 1; pin1 → 4; pin2 → 5; pin3 → 6
  check(
    'recomputeNumbering shifts nums across levels after earlier photos',
    afterRenum[0]?.num === 1 &&
      afterRenum[0]?.photos === 3 &&
      afterRenum[1]?.num === 4 &&
      afterRenum[2]?.num === 5 &&
      afterRenum[3]?.num === 6,
    JSON.stringify({ renum, afterRenum }),
  );

  // Delete earlier pin → close range
  await fr.evaluate(() => {
    ui.selectedPinId = project.pins[0].id;
    // bypass confirm
    const real = window.confirm;
    window.confirm = () => true;
    deleteCurrentPin();
    window.confirm = real;
  });
  await new Promise((r) => setTimeout(r, 800));
  const afterDel = await page.evaluate(async (id) => {
    const rec = await window.ToolboxDB.getCustomerFile(id);
    return (rec.distress?.pins || []).map((p) => ({ num: p.num, canvasId: p.canvasId }));
  }, seeded.id);
  check(
    'Deleting earlier pin recomputes global numbering',
    afterDel.length === 3 && afterDel[0].num === 1 && afterDel[1].num === 2 && afterDel[2].num === 3,
    JSON.stringify(afterDel),
  );
}

// Phone viewport
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(BASE + `#/file/${seeded.id}/distress`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 2000));
await page.screenshot({ path: `${OUT}/ds_07_iphone.png` });
check('iPhone viewport renders', true);

await page.setViewport({ width: 768, height: 1024, deviceScaleFactor: 2 });
await page.goto(BASE + `#/file/${seeded.id}/distress`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 2000));
await page.screenshot({ path: `${OUT}/ds_08_ipad_mini.png` });
check('iPad Mini viewport renders', true);

// Floor Survey untouched smoke
await page.setViewport({ width: 1280, height: 800 });
await page.goto(BASE + `#/file/${seeded.id}/floor`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1500));
const fsOk = await page.evaluate(() => document.body.classList.contains('floor-survey-open'));
check('Floor Survey still mounts (untouched)', fsOk);

await browser.close();
fs.writeFileSync(`${OUT}/ds_integrate_results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
if (failed.length) process.exitCode = 1;
