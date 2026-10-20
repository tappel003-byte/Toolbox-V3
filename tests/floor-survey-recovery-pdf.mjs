/**
 * Floor Survey Save → one full-canvas recovery PDF.
 * Run: node tests/floor-survey-recovery-pdf.mjs
 * Requires: Chrome, puppeteer-core, static server on :8765
 * Synthetic Customer File only.
 */
import { createRequire } from 'module';
import { writeFileSync, mkdirSync } from 'fs';
const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('/tmp/node_modules/puppeteer-core');
}

const BASE = 'http://127.0.0.1:8765/index.html';
const FILE_ID = 'fs-recovery-synth';
const CANVAS_ID = 'canvas-recovery-1';
const PLAN_ID = 'plan-recovery-1';
const ARTIFACTS = '/opt/cursor/artifacts';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' — ' + detail : ''));
}

mkdirSync(ARTIFACTS, { recursive: true });

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE', m.text());
});

await page.goto(BASE, { waitUntil: 'networkidle0' });

const seeded = await page.evaluate(async (ids) => {
  const { FILE_ID, CANVAS_ID, PLAN_ID } = ids;
  const plan = document.createElement('canvas');
  plan.width = 640;
  plan.height = 480;
  const ctx = plan.getContext('2d');
  ctx.fillStyle = '#f4f1ea';
  ctx.fillRect(0, 0, 640, 480);
  ctx.strokeStyle = '#1f2937';
  ctx.lineWidth = 6;
  ctx.strokeRect(36, 36, 568, 408);
  ctx.beginPath();
  ctx.moveTo(320, 36);
  ctx.lineTo(320, 444);
  ctx.moveTo(36, 240);
  ctx.lineTo(604, 240);
  ctx.stroke();
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, 28, 28);
  ctx.fillStyle = '#0000ff';
  ctx.fillRect(612, 452, 28, 28);
  const planUrl = plan.toDataURL('image/png');

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

  await window.ToolboxDB.putMedia(PLAN_ID, planUrl);
  const rec = window.ToolboxApp.blankCustomerFile(FILE_ID);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Synthetic';
  rec.lastName = 'Recovery';
  rec.propertyAddress = '1 Fixture Lane';
  rec.planSetup.canvases = [
    {
      id: CANVAS_ID,
      name: 'First Floor',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      plan: { id: PLAN_ID, width: 640, height: 480 },
      rooms: [],
      frontDoorFacing: 'S',
      frontDoor: null,
    },
  ];
  rec.planSetup.activeCanvasId = CANVAS_ID;
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  window.ToolboxPlanSetup.ensureFloorSurveyCanvasRef(rec, CANVAS_ID);
  const now = Date.now();
  rec.floorSurvey.byCanvasId[CANVAS_ID].boundary = [
    { x: 36, y: 36 },
    { x: 604, y: 36 },
    { x: 604, y: 444 },
    { x: 36, y: 444 },
  ];
  rec.floorSurvey.byCanvasId[CANVAS_ID].areas = [
    {
      id: 'area-recovery-1',
      name: 'Boundary 1',
      polygon: [
        { x: 36, y: 36 },
        { x: 604, y: 36 },
        { x: 604, y: 444 },
        { x: 36, y: 444 },
      ],
      createdAt: now,
    },
  ];
  rec.floorSurvey.byCanvasId[CANVAS_ID].points = [
    { id: 'pt-nw', floorId: CANVAS_ID, index: 1, x: 80, y: 80, value: 1.25, isBasePoint: true, label: 'BP1', createdAt: now },
    { id: 'pt-ne', floorId: CANVAS_ID, index: 2, x: 560, y: 80, value: 2.5, createdAt: now },
    { id: 'pt-sw', floorId: CANVAS_ID, index: 3, x: 80, y: 400, value: 3.75, createdAt: now },
    { id: 'pt-se', floorId: CANVAS_ID, index: 4, x: 560, y: 400, value: 8.75, createdAt: now },
    { id: 'pt-mid', floorId: CANVAS_ID, index: 5, x: 320, y: 240, value: 5, createdAt: now },
  ];
  await window.ToolboxDB.saveCustomerFile(rec);
  return { planUrlLength: planUrl.length };
}, { FILE_ID, CANVAS_ID, PLAN_ID });
check('Synthetic Customer File seeded', seeded.planUrlLength > 100, JSON.stringify(seeded));

const sheet = await page.evaluate(async (ids) => {
  const api = window.ToolboxFloorSurvey;
  const floor = {
    id: ids.CANVAS_ID,
    projectId: ids.FILE_ID,
    name: 'First Floor',
    order: 0,
    planDataUrl: await window.ToolboxDB.getMedia(ids.PLAN_ID),
    planWidth: 640,
    planHeight: 480,
    boundary: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    points: undefined,
  };
  const points = [
    { id: 'pt-nw', floorId: ids.CANVAS_ID, index: 1, x: 80, y: 80, value: 1.25, isBasePoint: true, createdAt: 1 },
    { id: 'pt-ne', floorId: ids.CANVAS_ID, index: 2, x: 560, y: 80, value: 2.5, createdAt: 1 },
    { id: 'pt-sw', floorId: ids.CANVAS_ID, index: 3, x: 80, y: 400, value: 3.75, createdAt: 1 },
    { id: 'pt-se', floorId: ids.CANVAS_ID, index: 4, x: 560, y: 400, value: 8.75, createdAt: 1 },
    { id: 'pt-mid', floorId: ids.CANVAS_ID, index: 5, x: 320, y: 240, value: 5, createdAt: 1 },
  ];
  const expected = api.recoveryCanvasSize(640, 480);
  const zoomed = { scale: 14, tx: -8000, ty: -6000, viewWidth: 180, viewHeight: 120 };
  const full = await api.renderFloorSurveyRecoveryCanvas({ floor, points, viewport: null });
  const croppedInput = await api.renderFloorSurveyRecoveryCanvas({ floor, points, viewport: zoomed });
  const read = (canvas, x, y) => {
    const px = canvas.getContext('2d').getImageData(x, y, 1, 1).data;
    return [px[0], px[1], px[2], px[3]];
  };
  const scale = expected.scale;
  const nw = read(full, Math.round(80 * scale), Math.round(80 * scale));
  const se = read(full, Math.round(560 * scale), Math.round(400 * scale));
  const tl = read(full, 4, 4);
  const br = read(full, full.width - 4, full.height - 4);
  const sameGeom =
    full.width === croppedInput.width &&
    full.height === croppedInput.height &&
    full.width === expected.width &&
    full.height === expected.height;
  const samePixel =
    nw.join(',') === read(croppedInput, Math.round(80 * scale), Math.round(80 * scale)).join(',') &&
    se.join(',') === read(croppedInput, Math.round(560 * scale), Math.round(400 * scale)).join(',');
  return {
    expected,
    width: full.width,
    height: full.height,
    zoomedWouldBe: zoomed,
    sameGeom,
    samePixel,
    nw,
    se,
    tl,
    br,
    label: api.recoveryReadingLabel(points[0], floor),
    png: full.toDataURL('image/png'),
  };
}, { FILE_ID, CANVAS_ID, PLAN_ID });

check(
  'Full-canvas render ignores zoomed viewport',
  sheet.sameGeom && sheet.samePixel && sheet.width > sheet.zoomedWouldBe.viewWidth && sheet.height > sheet.zoomedWouldBe.viewHeight,
  JSON.stringify({ expected: sheet.expected, width: sheet.width, height: sheet.height, sameGeom: sheet.sameGeom, samePixel: sheet.samePixel }),
);
check(
  'Corner plan pixels and both far readings are on the sheet',
  sheet.tl[0] > 200 && sheet.tl[1] < 40 && sheet.br[2] > 200 && sheet.br[0] < 40 && sheet.nw[1] > sheet.nw[0] && sheet.se[0] > 150,
  JSON.stringify({ tl: sheet.tl, br: sheet.br, nw: sheet.nw, se: sheet.se, label: sheet.label }),
);
check('Reading label is the plotted value', sheet.label === '1.25', sheet.label);

writeFileSync(ARTIFACTS + '/floor-survey-recovery-sheet.png', Buffer.from(sheet.png.split(',')[1], 'base64'));

async function openFloor() {
  await page.goto(BASE + '#/file/' + FILE_ID + '/floor', { waitUntil: 'networkidle0' });
  await page.waitForSelector('[aria-label="Save"]', { timeout: 8000 });
  await page.waitForSelector('[data-floor-viewport]', { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 400));
}

async function readViewport() {
  return page.evaluate(() => {
    const el = document.querySelector('[data-floor-viewport]');
    const canvas = el && el.querySelector('canvas');
    return {
      scale: Number(el?.getAttribute('data-canvas-scale')),
      tx: Number(el?.getAttribute('data-canvas-tx')),
      ty: Number(el?.getAttribute('data-canvas-ty')),
      viewW: canvas ? canvas.width : 0,
      viewH: canvas ? canvas.height : 0,
    };
  });
}

async function clickDone() {
  // Done saves first, so the Save confirmation flashes past on the way. What
  // is being waited for is Done's own word.
  await page.evaluate(() => {
    window.__doneResult = null;
    const el = document.querySelector('[data-save-status]');
    const obs = new MutationObserver(() => {
      const status = el.getAttribute('data-save-status') || '';
      if (/done|contour/i.test(status)) {
        window.__doneResult = { status, tone: el.getAttribute('data-save-tone') || '' };
      }
    });
    obs.observe(el, { attributes: true, attributeFilter: ['data-save-status', 'data-save-tone'] });
  });
  await page.click('[data-floor-done]');
  await page.waitForFunction(() => window.__doneResult && window.__doneResult.status, { timeout: 25000 });
  return page.evaluate(() => window.__doneResult);
}

async function watchStatus() {
  await page.evaluate(() => {
    window.__saveResult = null;
    const el = document.querySelector('[data-save-status]');
    let sawBlank = !(el?.getAttribute('data-save-status') || '');
    const obs = new MutationObserver(() => {
      const status = el.getAttribute('data-save-status') || '';
      if (!status) sawBlank = true;
      if (sawBlank && status) {
        window.__saveResult = {
          status,
          tone: el.getAttribute('data-save-tone') || '',
        };
      }
    });
    obs.observe(el, { attributes: true, attributeFilter: ['data-save-status', 'data-save-tone'] });
  });
}

async function clickSave() {
  await page.evaluate(() => {
    window.__saveResult = null;
    const el = document.querySelector('[data-save-status]');
    let sawBlank = !(el?.getAttribute('data-save-status') || '');
    const obs = new MutationObserver(() => {
      const status = el.getAttribute('data-save-status') || '';
      if (!status) sawBlank = true;
      if (sawBlank && status) {
        window.__saveResult = {
          status,
          tone: el.getAttribute('data-save-tone') || '',
        };
      }
    });
    obs.observe(el, { attributes: true, attributeFilter: ['data-save-status', 'data-save-tone'] });
  });
  await page.click('[aria-label="Save"]');
  await page.waitForFunction(() => window.__saveResult && window.__saveResult.status, { timeout: 20000 });
  return page.evaluate(() => window.__saveResult);
}

async function recoveryRecord() {
  return page.evaluate(async (ids) => {
    const rec = await window.ToolboxDB.getCustomerFile(ids.FILE_ID);
    const layer = rec.floorSurvey.byCanvasId[ids.CANVAS_ID];
    // Read what the record points at, not a name guessed from the canvas id:
    // each Save mints a new one so the Cabinet actually receives it.
    const mediaId = window.ToolboxFloorSurvey.recoveryPdfMediaIdFor(ids.CANVAS_ID);
    const pdf = await window.ToolboxDB.getMedia(layer.recoveryPdfMediaId || mediaId);
    const db = await new Promise((res, rej) => {
      const req = indexedDB.open('toolbox', 2);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const keys = await new Promise((res, rej) => {
      const tx = db.transaction('media', 'readonly');
      const req = tx.objectStore('media').getAllKeys();
      req.onsuccess = () => res(req.result.map(String));
      req.onerror = () => rej(req.error);
    });
    const header = pdf ? atob(pdf.split(',')[1]).slice(0, 1500) : '';
    const width = /\/Width (\d+)/.exec(header);
    const height = /\/Height (\d+)/.exec(header);
    return {
      points: (layer.points || []).map((p) => ({ id: p.id, value: p.value })),
      mediaIdOnLayer: layer.recoveryPdfMediaId || '',
      expectedId: mediaId,
      pdf: pdf || '',
      recoveryKeys: keys.filter((key) => key.startsWith('fsrec_')),
      allMediaKeys: keys,
      pdfWidth: width ? Number(width[1]) : 0,
      pdfHeight: height ? Number(height[1]) : 0,
      updatedAt: layer.recoveryPdfUpdatedAt || '',
      // Done taking points: Save files the level's contour as well, which is
      // the one thing Distress Survey and Report Builder were both waiting
      // on. Both read the level, so filing it is sending it to both.
      contour: (function () {
        const canvas = window.ToolboxPlanSetup.canvasById(rec, ids.CANVAS_ID);
        const found = window.ToolboxPlanSetup.contourLayer(canvas);
        return found
          ? { id: found.id, w: found.width, h: found.height, points: found.pointCount,
              area: found.areaName || '' }
          : null;
      })(),
      // The picture the layer points at is really in the media store: a
      // level holding an id with no bytes behind it is a bare plan with a
      // promise on it.
      contourStored: (function () {
        const canvas = window.ToolboxPlanSetup.canvasById(rec, ids.CANVAS_ID);
        const found = window.ToolboxPlanSetup.contourLayer(canvas);
        return !!found && keys.indexOf(found.id) !== -1;
      })(),
    };
  }, { FILE_ID, CANVAS_ID });
}

await openFloor();
const beforeZoom = await readViewport();
await page.evaluate(() => {
  const el = document.querySelector('[data-floor-viewport]');
  const rect = el.getBoundingClientRect();
  el.dispatchEvent(new WheelEvent('wheel', {
    deltaY: -700,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    bubbles: true,
    cancelable: true,
  }));
});
await new Promise((r) => setTimeout(r, 200));
const zoomed = await readViewport();
check(
  'Viewport can zoom before Save',
  Number.isFinite(beforeZoom.scale) && zoomed.scale > beforeZoom.scale + 0.05,
  JSON.stringify({ beforeZoom, zoomed }),
);

const saved = await clickSave();
const afterSaveView = await readViewport();
const stored = await recoveryRecord();
// Tim: "When we drop our last point there really is no complete. If we had a
// complete -- I'm done taking points -- generate the contour immediately, it
// could hit save." Save is that moment, so the level comes away carrying its
// contour and nobody has to remember a button in another tab.
check('Save alone does not file a contour — Done is the end of point-taking',
  !stored.contour, JSON.stringify({ contour: stored.contour }));

// Done taking points. Tim: "Next to the Save button there should be a pill of
// a button that says Done. I hit Done and it's done." It saves, and it files
// the level's contour -- which is the one thing Distress Survey and Report
// Builder were both waiting on, since both read the level.
const donePill = await page.evaluate(() => {
  const el = document.querySelector('[data-floor-done]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const save = document.querySelector('[aria-label="Save"]').getBoundingClientRect();
  return { label: el.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height),
    besideSave: Math.abs(r.left - save.right) < 24, pill: getComputedStyle(el).borderRadius };
});
check('a Done pill sits next to Save',
  !!donePill && donePill.label === 'Done' && donePill.besideSave &&
  parseFloat(donePill.pill) >= 12,
  JSON.stringify(donePill));

const done = await clickDone();
const afterDone = await recoveryRecord();
check('Done files the level\'s contour, drawn from the readings',
  /Done/.test(done.status) && done.tone === 'ok' &&
  !!afterDone.contour && !!afterDone.contour.id &&
  afterDone.contour.points === afterDone.points.length &&
  afterDone.contour.w > 0 && afterDone.contour.h > 0 &&
  afterDone.contourStored,
  JSON.stringify({ status: done.status, contour: afterDone.contour,
    stored: afterDone.contourStored }));

// Press it again: a button, not a state. Nothing is locked, and the level
// ends up with exactly one contour.
const doneAgain = await clickDone();
const afterAgain = await recoveryRecord();
check('pressing Done again redraws it, and leaves one',
  /Done/.test(doneAgain.status) && !!afterAgain.contour &&
  afterAgain.contourStored &&
  afterAgain.allMediaKeys.filter((key) => key === afterDone.contour.id).length === 0,
  JSON.stringify({ was: afterDone.contour.id, now: afterAgain.contour.id }));
check(
  'Save persists points and one recovery PDF',
  saved.status === 'Saved · Recovery PDF updated.' &&
    saved.tone === 'ok' &&
    stored.points.length === 5 &&
    stored.points.some((p) => p.id === 'pt-se' && p.value === 8.75) &&
    // The id is minted per Save so the Cabinet actually receives the new
    // one; what must stay true is that there is exactly one, and the layer
    // points at it.
    stored.mediaIdOnLayer.startsWith(stored.expectedId) &&
    stored.recoveryKeys.length === 1 &&
    stored.recoveryKeys[0] === stored.mediaIdOnLayer &&
    stored.pdf.startsWith('data:application/pdf'),
  JSON.stringify({ status: saved, points: stored.points, keys: stored.recoveryKeys, mediaId: stored.mediaIdOnLayer }),
);
check(
  'Stored PDF is the full plan, not the zoomed viewport',
  stored.pdfWidth === sheet.expected.width &&
    stored.pdfHeight === sheet.expected.height &&
    stored.pdfWidth > afterSaveView.viewW &&
    stored.pdfHeight > afterSaveView.viewH,
  JSON.stringify({ pdf: [stored.pdfWidth, stored.pdfHeight], view: [afterSaveView.viewW, afterSaveView.viewH], expected: sheet.expected }),
);
check(
  'Save does not change zoom or pan',
  afterSaveView.scale === zoomed.scale && afterSaveView.tx === zoomed.tx && afterSaveView.ty === zoomed.ty,
  JSON.stringify({ zoomed, afterSaveView }),
);

await page.screenshot({ path: ARTIFACTS + '/floor-survey-save-confirmation-desktop.png' });
writeFileSync(ARTIFACTS + '/floor-survey-recovery.pdf', Buffer.from(stored.pdf.split(',')[1], 'base64'));

const firstPdf = stored.pdf;

await page.evaluate(async (ids) => {
  const rec = await window.ToolboxDB.getCustomerFile(ids.FILE_ID);
  const layer = rec.floorSurvey.byCanvasId[ids.CANVAS_ID];
  layer.points = layer.points.map((p) => (p.id === 'pt-mid' ? { ...p, value: 6.5 } : p));
  await window.ToolboxDB.saveCustomerFile(rec);
}, { FILE_ID, CANVAS_ID });
await page.goto(BASE + '#/file/' + FILE_ID, { waitUntil: 'networkidle0' });
await openFloor();
const reloadedMid = await page.evaluate(async (ids) => {
  const rec = await window.ToolboxDB.getCustomerFile(ids.FILE_ID);
  return rec.floorSurvey.byCanvasId[ids.CANVAS_ID].points.find((p) => p.id === 'pt-mid')?.value;
}, { FILE_ID, CANVAS_ID });
check('Reloaded survey sees the edited reading', reloadedMid === 6.5, String(reloadedMid));
const second = await clickSave();
const replaced = await recoveryRecord();
check(
  'Second Save replaces the recovery PDF',
  second.status === 'Saved · Recovery PDF updated.' &&
    // Replaced, not accumulated: still exactly one, and the old object is
    // gone rather than left behind as Save 1 / Save 2.
    replaced.recoveryKeys.length === 1 &&
    replaced.recoveryKeys[0] === replaced.mediaIdOnLayer &&
    replaced.pdf.startsWith('data:application/pdf') &&
    replaced.pdf !== firstPdf &&
    replaced.points.some((p) => p.id === 'pt-mid' && p.value === 6.5),
  JSON.stringify({
    keys: replaced.recoveryKeys,
    changed: replaced.pdf !== firstPdf,
    mid: replaced.points.find((p) => p.id === 'pt-mid'),
  }),
);
check(
  'and under a new name, so the File Cabinet receives it',
  // Sync skips media whose id it already holds. Under the old stable id the
  // bytes changed but the name did not, so the Cabinet kept the first
  // recovery PDF a canvas ever had and every later Save stayed on the
  // device -- silently, in the one thing meant to survive a lost device.
  replaced.mediaIdOnLayer !== stored.mediaIdOnLayer &&
    replaced.mediaIdOnLayer.startsWith(stored.expectedId),
  JSON.stringify({ first: stored.mediaIdOnLayer, second: replaced.mediaIdOnLayer }),
);

const knownGood = replaced.pdf;
await page.evaluate(() => {
  window.ToolboxFloorSurvey.setRecoveryRendererForTests(() => Promise.reject(new Error('render failed')));
});
const failedRender = await clickSave();
const afterRenderFail = await recoveryRecord();
check(
  'Render failure does not report success or replace the PDF',
  failedRender.status === 'Survey saved · Recovery PDF not updated' &&
    failedRender.tone === 'err' &&
    afterRenderFail.pdf === knownGood &&
    afterRenderFail.recoveryKeys.length === 1,
  JSON.stringify({ status: failedRender, samePdf: afterRenderFail.pdf === knownGood, keys: afterRenderFail.recoveryKeys }),
);
await page.evaluate(() => window.ToolboxFloorSurvey.setRecoveryRendererForTests(null));

await page.evaluate(() => {
  const orig = window.ToolboxDB.putMedia.bind(window.ToolboxDB);
  window.__restorePutMedia = orig;
  window.ToolboxDB.putMedia = () => Promise.reject(new Error('offline-disk'));
});
const failedStore = await clickSave();
const afterStoreFail = await recoveryRecord();
await page.evaluate(() => {
  window.ToolboxDB.putMedia = window.__restorePutMedia;
});
check(
  'Storage failure keeps the prior recovery PDF',
  failedStore.status === 'Survey saved · Recovery PDF not updated' &&
    failedStore.tone === 'err' &&
    afterStoreFail.pdf === knownGood &&
    !failedStore.status.includes('Saved · Recovery PDF updated'),
  JSON.stringify({ status: failedStore, samePdf: afterStoreFail.pdf === knownGood }),
);

await page.setOfflineMode(true);
const offlineRequests = [];
page.on('requestfailed', (req) => offlineRequests.push(req.url()));
const offlineSave = await clickSave();
const offlineStored = await recoveryRecord();
check(
  'Save works offline',
  offlineSave.status === 'Saved · Recovery PDF updated.' &&
    offlineSave.tone === 'ok' &&
    offlineStored.recoveryKeys.length === 1 &&
    offlineStored.pdf.startsWith('data:application/pdf'),
  JSON.stringify({ status: offlineSave, keys: offlineStored.recoveryKeys, failedRequests: offlineRequests.length }),
);
await page.setOfflineMode(false);

await page.screenshot({ path: ARTIFACTS + '/floor-survey-save-confirmation-desktop-offline.png' });

await page.setViewport({ width: 768, height: 1024, deviceScaleFactor: 1 });
await openFloor();
const ipadSaved = await clickSave();
await page.screenshot({ path: ARTIFACTS + '/floor-survey-save-ipad.png' });
const ipadLayout = await page.evaluate(() => {
  const host = document.querySelector('.floor-survey-host');
  const save = host.querySelector('[aria-label="Save"]').getBoundingClientRect();
  const undo = host.querySelector('[aria-label="Undo"]').getBoundingClientRect();
  const back = host.querySelector('[aria-label="Back to Customer File"]').getBoundingClientRect();
  const header = host.querySelector('header').getBoundingClientRect();
  const status = host.querySelector('[data-save-status]').getBoundingClientRect();
  const overlap = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
  return {
    gap: undo.left - save.right,
    backGap: save.left - back.right,
    statusGap: save.left - status.right,
    inHeader: save.top >= header.top - 1 && save.bottom <= header.bottom + 1,
    overlap: overlap(save, undo) || overlap(save, back) || overlap(status, save),
    confirmed: host.querySelector('[data-save-status]')?.getAttribute('data-save-status') || '',
  };
});
check('iPad Save confirmation is the success text', ipadSaved.status === 'Saved · Recovery PDF updated.', ipadSaved.status);
check('iPad Save control stays in the header without overlap', ipadLayout.gap >= 0 && ipadLayout.backGap >= 0 && ipadLayout.inHeader && !ipadLayout.overlap, JSON.stringify(ipadLayout));

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await openFloor();
const phoneSaved = await clickSave();
await page.screenshot({ path: ARTIFACTS + '/floor-survey-save-confirmation-phone.png' });
const phoneLayout = await page.evaluate(() => {
  const save = document.querySelector('[aria-label="Save"]').getBoundingClientRect();
  const undo = document.querySelector('[aria-label="Undo"]').getBoundingClientRect();
  const more = document.querySelector('[aria-label="More"]').getBoundingClientRect();
  const status = document.querySelector('[data-save-status]').getBoundingClientRect();
  const overlap = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
  return {
    status: document.querySelector('[data-save-status]')?.getAttribute('data-save-status') || '',
    statusRight: status.right,
    saveLeft: save.left,
    gapToSave: save.left - status.right,
    overlapSave: overlap(status, save),
    overlapUndo: overlap(save, undo),
    moreVisible: more.width > 0 && more.right <= window.innerWidth + 1,
  };
});
check(
  'Phone confirmation stays in the top bar',
  phoneSaved.status === 'Saved · Recovery PDF updated.' && phoneLayout.gapToSave >= -1 && !phoneLayout.overlapSave && !phoneLayout.overlapUndo && phoneLayout.moreVisible,
  JSON.stringify(phoneLayout),
);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
if (failed.length) process.exitCode = 1;
