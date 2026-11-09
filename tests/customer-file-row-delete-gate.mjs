/**
 * On-this-device ••• Delete gate (Tim, Nov 7, 2026).
 * No DS pin photos + no FS points → Delete on the menu.
 * Either present → Explorer note. Floor plan alone does not block.
 *
 * Run: node tests/customer-file-row-delete-gate.mjs
 * Requires static server at http://127.0.0.1:8765
 */
import { createRequire } from 'module';
import { mkdir, writeFile } from 'fs/promises';

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

function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

await mkdir(OUT, { recursive: true });

{
  // Pure detector checks via page after load — seed helpers first inline.
  const planOnly = { planSetup: { canvases: [{ plan: { id: 'p' } }] }, distress: { pins: [] }, floorSurvey: {} };
  const withPinPhoto = {
    distress: { pins: [{ id: 'a', photos: ['ph1'] }] },
    floorSurvey: { byCanvasId: {} },
  };
  const withPoints = {
    distress: { pins: [] },
    floorSurvey: { byCanvasId: { c1: { points: [{ id: 'pt1', x: 1, y: 1, value: 1 }] } } },
  };
  const pinNoPhoto = {
    distress: { pins: [{ id: 'a', photos: [] }] },
    floorSurvey: { byCanvasId: {} },
  };
  // Mirror detector logic for offline assert before browser
  function hasField(record) {
    const distress = record.distress || {};
    const pins = Array.isArray(distress.pins) ? distress.pins : [];
    for (const pin of pins) {
      if (Array.isArray(pin.photos) && pin.photos.length) return true;
    }
    if (Array.isArray(distress.quickCapture) && distress.quickCapture.length) return true;
    if (distress.photoSources && Object.keys(distress.photoSources).length) return true;
    const walk = distress.jobWalk && typeof distress.jobWalk === 'object' ? distress.jobWalk : null;
    if (walk && Array.isArray(walk.videos) && walk.videos.length) return true;
    if (walk && Array.isArray(walk.notes) && walk.notes.some((note) =>
      note && (note.audioId || (typeof note.text === 'string' && note.text.trim())))) {
      return true;
    }
    const layers = Object.values((record.floorSurvey && record.floorSurvey.byCanvasId) || {});
    return layers.some((layer) => layer && Array.isArray(layer.points) && layer.points.length);
  }
  check('detector: plan-only is not field capture', !hasField(planOnly));
  check('detector: pin with photo is field capture', hasField(withPinPhoto));
  check('detector: FS points are field capture', hasField(withPoints));
  check('detector: pin without photos is not field capture', !hasField(pinNoPhoto));
  check('detector: Job Walk video is field capture', hasField({
    distress: { pins: [], jobWalk: { videos: [{ id: 'vid_1' }], notes: [] } },
    floorSurvey: {},
  }));
  check('detector: Job Walk audio note is field capture', hasField({
    distress: { pins: [], jobWalk: { videos: [], notes: [{ id: 'n1', audioId: 'vm_1' }] } },
    floorSurvey: {},
  }));
}

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
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

  const planCanvas = document.createElement('canvas');
  planCanvas.width = 400;
  planCanvas.height = 300;
  const ctx = planCanvas.getContext('2d');
  ctx.fillStyle = '#eee';
  ctx.fillRect(0, 0, 400, 300);
  await window.ToolboxDB.putMedia('gate-plan', planCanvas.toDataURL('image/jpeg', 0.8));

  const emptyish = window.ToolboxApp.blankCustomerFile('gate-empty');
  window.ToolboxPlanSetup.ensurePlanSetup(emptyish);
  emptyish.firstName = 'Empty';
  emptyish.lastName = 'Stub';
  emptyish.propertyAddress = '1 Empty St';
  emptyish.planSetup.canvases[0].plan = { id: 'gate-plan', width: 400, height: 300 };
  await window.ToolboxDB.saveCustomerFile(emptyish);

  const withDs = window.ToolboxApp.blankCustomerFile('gate-ds');
  window.ToolboxPlanSetup.ensurePlanSetup(withDs);
  withDs.firstName = 'Has';
  withDs.lastName = 'Distress';
  withDs.propertyAddress = '2 Pin Ave';
  withDs.distress = {
    id: 'd-gate',
    pins: [{ id: 'pin1', canvasId: withDs.planSetup.canvases[0].id, photos: ['ph_gate'], num: 1 }],
    drawings: [],
    startNum: 1,
    nextNum: 2,
  };
  await window.ToolboxDB.saveCustomerFile(withDs);

  const withFs = window.ToolboxApp.blankCustomerFile('gate-fs');
  window.ToolboxPlanSetup.ensurePlanSetup(withFs);
  withFs.firstName = 'Has';
  withFs.lastName = 'Floor';
  withFs.propertyAddress = '3 Point Rd';
  const cv = withFs.planSetup.canvases[0].id;
  withFs.floorSurvey = {
    id: 'fs-gate',
    byCanvasId: {
      [cv]: {
        canvasId: cv,
        points: [{ id: 'p1', floorId: cv, index: 1, x: 10, y: 10, value: 1 }],
        areas: [],
      },
    },
  };
  await window.ToolboxDB.saveCustomerFile(withFs);
});

await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.waitForSelector('.cabinet-row-menu', { timeout: 20000 });

const api = await page.evaluate(() => {
  return {
    empty: window.ToolboxApp.hasFieldCaptureCustomerData
      ? null
      : 'missing-api',
  };
});
check('ToolboxApp.hasFieldCaptureCustomerData exported', api.empty !== 'missing-api');

const detectorLive = await page.evaluate(async () => {
  const empty = await window.ToolboxDB.getCustomerFile('gate-empty');
  const ds = await window.ToolboxDB.getCustomerFile('gate-ds');
  const fs = await window.ToolboxDB.getCustomerFile('gate-fs');
  const fn = window.ToolboxApp.hasFieldCaptureCustomerData;
  return {
    empty: fn(empty),
    ds: fn(ds),
    fs: fn(fs),
  };
});
check('live detector: plan+contact only → false', detectorLive.empty === false);
check('live detector: DS pin photos → true', detectorLive.ds === true);
check('live detector: FS points → true', detectorLive.fs === true);

async function openMenuForName(namePart) {
  return page.evaluate((namePart) => {
    const shells = [...document.querySelectorAll('.cabinet-row-shell, .customer-file-row, [class*="cabinet"]')];
    // Find row by display text
    const rows = [...document.querySelectorAll('button.cabinet-row-menu__toggle')];
    for (const toggle of rows) {
      const shell = toggle.closest('.cabinet-row-shell') || toggle.parentElement?.parentElement;
      const text = (shell && shell.innerText) || '';
      if (text.includes(namePart)) {
        toggle.click();
        const menu = toggle.closest('.cabinet-row-menu');
        const panel = menu && menu.querySelector('.cabinet-row-menu__panel');
        return {
          open: !!(menu && menu.classList.contains('is-open')),
          hasDelete: !!(panel && [...panel.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Delete')),
          hasCheckIn: !!(panel && [...panel.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Check In')),
          note: panel && panel.querySelector('.cabinet-row-menu__note')
            ? panel.querySelector('.cabinet-row-menu__note').textContent.trim()
            : '',
        };
      }
    }
    return { open: false, error: 'row not found', hasDelete: false, hasCheckIn: false, note: '' };
  }, namePart);
}

const emptyMenu = await openMenuForName('Empty Stub');
check('empty/plan row: Check In present', emptyMenu.hasCheckIn === true, JSON.stringify(emptyMenu));
check('empty/plan row: Delete present', emptyMenu.hasDelete === true, JSON.stringify(emptyMenu));
check('empty/plan row: no Explorer note', !emptyMenu.note, emptyMenu.note);

// close menus
await page.evaluate(() => {
  document.querySelectorAll('.cabinet-row-menu.is-open').forEach((m) => m.classList.remove('is-open'));
});

const dsMenu = await openMenuForName('Has Distress');
check('DS photo row: Check In present', dsMenu.hasCheckIn === true, JSON.stringify(dsMenu));
check('DS photo row: no Delete', dsMenu.hasDelete === false, JSON.stringify(dsMenu));
check('DS photo row: Explorer note', /Explorer/i.test(dsMenu.note) && /customer data/i.test(dsMenu.note), dsMenu.note);

await page.evaluate(() => {
  document.querySelectorAll('.cabinet-row-menu.is-open').forEach((m) => m.classList.remove('is-open'));
});

const fsMenu = await openMenuForName('Has Floor');
check('FS points row: Check In present', fsMenu.hasCheckIn === true, JSON.stringify(fsMenu));
check('FS points row: no Delete', fsMenu.hasDelete === false, JSON.stringify(fsMenu));
check('FS points row: Explorer note', /Explorer/i.test(fsMenu.note) && /customer data/i.test(fsMenu.note), fsMenu.note);

await page.screenshot({ path: `${OUT}/row-delete-gate-phone.png` });
await writeFile(`${OUT}/row-delete-gate.json`, JSON.stringify({ emptyMenu, dsMenu, fsMenu, detectorLive, results }, null, 2));

const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
await browser.close();
if (failed.length) process.exit(1);
