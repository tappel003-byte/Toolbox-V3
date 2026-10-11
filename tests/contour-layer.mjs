/**
 * The contour layer: a black-and-white contour of one level, shown under the
 * damage pins in Distress Survey.
 *
 * Run: node tests/contour-layer.mjs   (needs a static server on 8765)
 *
 * What matters here is that the layer lines up with the plan and travels with
 * the Customer File. Both come down to the same thing: the layer is drawn at
 * the plan's own pixel extent, and its media id is collected everywhere the
 * plan's is. A layer a collector misses is a layer that does not sync, or
 * whose bytes stay behind when the working copy is removed.
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
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' — ' + detail : ''));
}

function makeImage(page, w, h, draw) {
  return page.evaluate(
    (W, H, kind) => {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const ctx = c.getContext('2d');
      if (kind === 'plan') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 3;
        ctx.strokeRect(20, 20, W - 40, H - 40);
      } else {
        // A contour layer: ink on transparent, so the plan shows through.
        ctx.strokeStyle = '#17130e';
        ctx.lineWidth = 2;
        for (let r = 40; r < Math.min(W, H) / 2; r += 30) {
          ctx.beginPath();
          ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      return c.toDataURL('image/png');
    },
    w,
    h,
    draw,
  );
}

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

await page.goto(BASE, { waitUntil: 'networkidle0' });

// ---------------------------------------------------------------- helpers
const planImg = await makeImage(page, 400, 300, 'plan');
const contourImg = await makeImage(page, 400, 300, 'contour');

const unit = await page.evaluate(() => {
  const ps = window.ToolboxPlanSetup;
  const out = {};
  out.exports = ['contourLayer', 'canvasMediaIds', 'setContourLayer', 'clearContourLayer']
    .every((k) => typeof ps[k] === 'function');

  const rec = window.ToolboxApp.blankCustomerFile('cl-unit');
  ps.ensurePlanSetup(rec);
  const now = new Date().toISOString();
  rec.planSetup.canvases = [{
    id: 'canvas-one',
    name: 'Main Floor',
    createdAt: now,
    updatedAt: now,
    plan: { id: 'pl_plan1', width: 400, height: 300 },
    rooms: [],
    frontDoorFacing: 'S',
    frontDoor: null,
  }];
  rec.planSetup.activeCanvasId = 'canvas-one';

  const canvas = ps.canvasById(rec, 'canvas-one');
  out.beforePlanOnly = ps.canvasMediaIds(canvas).join(',');
  out.noLayerYet = ps.contourLayer(canvas) === null;

  const applied = ps.setContourLayer(rec, 'canvas-one', {
    id: 'pl_ct_one', width: 400, height: 300, surveyDate: '2026-10-09', pointCount: 42,
  });
  out.applied = !!applied && applied.retired === null;
  out.layerRead = !!ps.contourLayer(canvas);
  out.afterBoth = ps.canvasMediaIds(canvas).join(',');
  out.provenance = ps.contourLayer(canvas).surveyDate + '/' + ps.contourLayer(canvas).pointCount;
  // Drawn at the plan's extent: that is what makes a pin land in the same
  // place on both layers.
  out.sameExtent = ps.contourLayer(canvas).width === canvas.plan.width &&
    ps.contourLayer(canvas).height === canvas.plan.height;

  // Replacing names the retired id, so the caller can drop its bytes AFTER
  // the record is safely saved.
  const again = ps.setContourLayer(rec, 'canvas-one', { id: 'pl_ct_two', width: 400, height: 300 });
  out.replaceRetires = !!again && again.retired === 'pl_ct_one';
  out.replacedInPlace = ps.contourLayer(canvas).id === 'pl_ct_two';

  // A malformed layer is dropped rather than left for everything downstream
  // to guard against.
  canvas.contourLayer = { id: 'pl_ct_three' };            // no dimensions
  ps.ensurePlanSetup(rec);
  out.malformedDropped = canvas.contourLayer === null;

  ps.setContourLayer(rec, 'canvas-one', { id: 'pl_ct_four', width: 400, height: 300 });
  const cleared = ps.clearContourLayer(rec, 'canvas-one');
  out.cleared = !!cleared && cleared.retired === 'pl_ct_four' && ps.contourLayer(canvas) === null;
  out.clearLeavesPlan = canvas.plan && canvas.plan.id === 'pl_plan1';

  // Every collector. A plan id is gathered in several places and the layer has
  // to be in all of them.
  ps.setContourLayer(rec, 'canvas-one', { id: 'pl_ct_five', width: 400, height: 300 });
  out.syncLocal = window.ToolboxSync.mediaIdsForComponent(rec, 'plans').join(',');
  out.syncPayload = window.ToolboxSync._test.mediaIdsFromPayload(rec.planSetup, 'plans').join(',');
  return out;
});

check('Plan setup exports the layer helpers', unit.exports);
check('A level with no layer reports none', unit.noLayerYet);
check('Plan alone before a layer is written', unit.beforePlanOnly === 'pl_plan1', unit.beforePlanOnly);
check('Writing the layer puts it on the level', unit.applied && unit.layerRead);
check('The layer is drawn at the plan extent', unit.sameExtent);
check('Provenance is kept with it', unit.provenance === '2026-10-09/42', unit.provenance);
check('Both layers are the level media', unit.afterBoth === 'pl_plan1,pl_ct_one', unit.afterBoth);
check('Replacing names the retired layer', unit.replaceRetires && unit.replacedInPlace);
check('A malformed layer is dropped', unit.malformedDropped);
check('Clearing retires it and leaves the plan', unit.cleared && unit.clearLeavesPlan);
check('Sync collects the layer with the plan', unit.syncLocal === 'pl_plan1,pl_ct_five', unit.syncLocal);
check('The pull side collects it too', unit.syncPayload === 'pl_plan1,pl_ct_five', unit.syncPayload);

// Removing a working copy has to take the layer's bytes with it. Tested
// through the real removal rather than the collector, because the leak is the
// thing that matters.
const cleanup = await page.evaluate(async () => {
  const rec = window.ToolboxApp.blankCustomerFile('cl-clean');
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  const now = new Date().toISOString();
  rec.planSetup.canvases = [{
    id: 'c1', name: 'L', createdAt: now, updatedAt: now,
    plan: { id: 'pl_clean_plan', width: 10, height: 10 },
    contourLayer: { id: 'pl_clean_ct', width: 10, height: 10, createdAt: now },
    rooms: [], frontDoorFacing: 'S', frontDoor: null,
  }];
  rec.planSetup.activeCanvasId = 'c1';
  await window.ToolboxDB.putMedia('pl_clean_plan', 'data:image/png;base64,AA');
  await window.ToolboxDB.putMedia('pl_clean_ct', 'data:image/png;base64,BB');
  await window.ToolboxDB.saveCustomerFile(rec);
  const before = {
    plan: !!(await window.ToolboxDB.getMedia('pl_clean_plan')),
    layer: !!(await window.ToolboxDB.getMedia('pl_clean_ct')),
  };
  await window.ToolboxDB.removeLocalWorkingCopy([rec]);
  const after = {
    plan: !!(await window.ToolboxDB.getMedia('pl_clean_plan')),
    layer: !!(await window.ToolboxDB.getMedia('pl_clean_ct')),
  };
  return { before, after };
});
check(
  'Both layers were stored',
  cleanup.before.plan && cleanup.before.layer,
  JSON.stringify(cleanup.before),
);
check(
  'Removing the working copy takes the layer bytes too',
  !cleanup.after.plan && !cleanup.after.layer,
  JSON.stringify(cleanup.after),
);

// ------------------------------------------------- Distress shows the layer
const seeded = await page.evaluate(
  async (images) => {
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
    await window.ToolboxDB.putMedia('pl_plan_main', images.plan);
    await window.ToolboxDB.putMedia('pl_ct_main', images.contour);

    const id = 'cl-distress';
    const rec = window.ToolboxApp.blankCustomerFile(id);
    window.ToolboxPlanSetup.ensurePlanSetup(rec);
    rec.firstName = 'Contour';
    rec.lastName = 'Layer';
    rec.propertyAddress = '7 Dip Street';
    const now = new Date().toISOString();
    // One level only — the common job. The layers pill has to appear even
    // though the level pill does not.
    rec.planSetup.canvases = [{
      id: 'canvas-main',
      name: 'Main Floor',
      createdAt: now,
      updatedAt: now,
      plan: { id: 'pl_plan_main', width: 400, height: 300 },
      contourLayer: {
        id: 'pl_ct_main', width: 400, height: 300,
        createdAt: now, surveyDate: '2026-10-09', pointCount: 42,
      },
      rooms: [],
      frontDoorFacing: 'S',
      frontDoor: null,
    }];
    rec.planSetup.activeCanvasId = 'canvas-main';
    window.ToolboxPlanSetup.ensurePlanSetup(rec);
    rec.distress.activeCanvasId = 'canvas-main';
    rec.distress.pins = [{
      id: 'pin-1', canvasId: 'canvas-main', x: 200, y: 150,
      photos: [], note: '', location: '',
    }];
    await window.ToolboxDB.saveCustomerFile(rec);
    return { id };
  },
  { plan: planImg, contour: contourImg },
);

await page.goto(BASE + `#/file/${seeded.id}`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 700));
await page.click('[data-app="distress"]');
await new Promise((r) => setTimeout(r, 3000));

const fr = page.frames().find((f) => /distress-survey\/survey\.html/.test(f.url()));
check('Distress opened', !!fr);

if (fr) {
  await fr.waitForSelector('#screenWork.active, body.host-mode #stage', { timeout: 15000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1200));

  const shown = await fr.evaluate(() => {
    const row = document.getElementById('levelPill');
    const levelBtn = document.getElementById('levelPillBtn');
    const pill = document.getElementById('layerPill');
    const label = document.getElementById('layerPillLabel');
    const plan = document.getElementById('planLayerImage');
    const contour = document.getElementById('contourLayerImage');
    return {
      rowVisible: !!(row && row.getBoundingClientRect().height > 0),
      // Rendered, not merely flagged: both pills set their own display, which
      // beats the hidden attribute unless the stylesheet says otherwise.
      levelBtnHidden: !!(levelBtn && levelBtn.getBoundingClientRect().width === 0),
      pillVisible: !!(pill && pill.getBoundingClientRect().width > 0),
      label: label ? label.textContent : '',
      planDrawn: !!plan,
      contourDrawn: !!contour,
      planVisible: plan ? plan.getAttribute('visibility') !== 'hidden' : false,
      contourVisible: contour ? contour.getAttribute('visibility') !== 'hidden' : false,
      // The pin is the reason the layer exists; it must survive the layer.
      pinCount: document.querySelectorAll('#gPins .pin').length,
      // Drawn below the annotations, so pins stay on top of either layer.
      contourBeforeGroups: (function () {
        const svg = document.getElementById('planSvg');
        if (!svg || !contour) return false;
        const kids = Array.from(svg.children);
        return kids.indexOf(contour) < kids.indexOf(document.getElementById('gPins'));
      })(),
    };
  });

  check('A one-level job still gets the layers row', shown.rowVisible && shown.levelBtnHidden);
  check('The layers pill is offered', shown.pillVisible);
  check('It opens on the plan, as it always did', shown.label === 'Plan' && shown.planVisible && !shown.contourVisible);
  check('Both layers are in the drawing', shown.planDrawn && shown.contourDrawn);
  check('The contour sits under the pins', shown.contourBeforeGroups);
  check('The pin is still there', shown.pinCount === 1, String(shown.pinCount));

  const toggled = await fr.evaluate(() => {
    const read = () => {
      const plan = document.getElementById('planLayerImage');
      const contour = document.getElementById('contourLayerImage');
      return {
        label: document.getElementById('layerPillLabel').textContent,
        plan: plan.getAttribute('visibility') !== 'hidden',
        contour: contour.getAttribute('visibility') !== 'hidden',
        pins: document.querySelectorAll('#gPins .pin').length,
      };
    };
    const out = {};
    window.setLayerView('both');
    out.both = read();
    window.setLayerView('plan');
    out.planAgain = read();
    // Contour on its own is gone; asking for it must not hide the plan.
    window.setLayerView('contour');
    out.goneView = read();
    window.setLayerView('plan');
    out.options = Array.from(
      document.querySelectorAll('#layerPillMenu button[data-layer-view]'),
    ).map((b) => b.getAttribute('data-layer-view')).join(',');
    out.note = (document.querySelector('#layerPillMenu .lp-note') || {}).textContent || '';
    return out;
  });

  check(
    'Both shows the plan and the contour at once',
    toggled.both.plan && toggled.both.contour && toggled.both.label === 'Plan + contour',
    JSON.stringify(toggled.both),
  );
  check(
    'Back to the plan alone',
    toggled.planAgain.plan && !toggled.planAgain.contour,
    JSON.stringify(toggled.planAgain),
  );
  check(
    'The plan is never hidden any more',
    toggled.goneView.plan && !toggled.goneView.contour && toggled.goneView.label === 'Plan',
    JSON.stringify(toggled.goneView),
  );
  check(
    'The pins are untouched by any of it',
    toggled.both.pins === 1 && toggled.planAgain.pins === 1 && toggled.goneView.pins === 1,
  );
  check('Two layer choices, not three', toggled.options === 'plan,both', toggled.options);
  check(
    'It says what the contour was drawn from',
    /2026-10-09/.test(toggled.note),
    toggled.note,
  );
}

// ------------------------------------- a level with no layer offers nothing
const bare = await page.evaluate(async () => {
  const id = 'cl-bare';
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'No';
  rec.lastName = 'Layer';
  const now = new Date().toISOString();
  rec.planSetup.canvases = [{
    id: 'canvas-bare', name: 'Main Floor', createdAt: now, updatedAt: now,
    plan: { id: 'pl_plan_main', width: 400, height: 300 },
    rooms: [], frontDoorFacing: 'S', frontDoor: null,
  }];
  rec.planSetup.activeCanvasId = 'canvas-bare';
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.distress.activeCanvasId = 'canvas-bare';
  await window.ToolboxDB.saveCustomerFile(rec);
  return { id };
});

await page.goto(BASE + `#/file/${bare.id}`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 700));
await page.click('[data-app="distress"]');
await new Promise((r) => setTimeout(r, 3000));

const fr2 = page.frames().find((f) => /distress-survey\/survey\.html/.test(f.url()));
if (fr2) {
  await fr2.waitForSelector('body.host-mode #stage', { timeout: 15000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1000));
  const none = await fr2.evaluate(() => ({
    pillHidden: document.getElementById('layerPill').getBoundingClientRect().width === 0,
    rowHidden: document.getElementById('levelPill').getBoundingClientRect().height === 0,
    contourDrawn: !!document.getElementById('contourLayerImage'),
    planVisible: (document.getElementById('planLayerImage') || {}).getAttribute
      ? document.getElementById('planLayerImage').getAttribute('visibility') !== 'hidden'
      : false,
  }));
  check('No layer, no pill', none.pillHidden && !none.contourDrawn);
  check('And no empty row either', none.rowHidden);
  check('The plan is showing as always', none.planVisible);
}

// ------------------------------------------------------------------------
// The real thing: Floor Survey draws the contour and sends it.
//
// Everything above used a contour made in the test. This drives the actual
// composer, because the two claims that matter cannot be seeded: that the
// picture covers the plan's whole extent (which is what makes a pin land in
// the right place on it) and that it is transparent where there are no lines
// (which is what lets both layers show at once).
// ------------------------------------------------------------------------
const e2eSeed = await page.evaluate(async (planDataUrl) => {
  const id = 'cl-e2e';
  const canvasId = 'canvas-e2e';
  await window.ToolboxDB.putMedia('pl_e2e_plan', planDataUrl);
  const rec = window.ToolboxApp.blankCustomerFile(id);
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'End';
  rec.lastName = 'ToEnd';
  rec.propertyAddress = '9 Contour Way';
  const now = new Date().toISOString();
  rec.planSetup.canvases = [{
    id: canvasId, name: 'Main Floor', createdAt: now, updatedAt: now,
    plan: { id: 'pl_e2e_plan', width: 400, height: 300 },
    rooms: [], frontDoorFacing: 'S', frontDoor: null,
  }];
  rec.planSetup.activeCanvasId = canvasId;
  window.ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.floorSurvey.inspectionDate = '2026-10-10';
  // A closed boundary across most of the plan, with readings that actually
  // vary so there is something for the contours to follow.
  // Two surfaces, as a real job has: the house, and a garage sloped hard for
  // drainage. The garage is the one that must be able to stay out.
  const house = [{ x: 30, y: 30 }, { x: 370, y: 30 }, { x: 370, y: 160 }, { x: 30, y: 160 }];
  const garage = [{ x: 30, y: 180 }, { x: 370, y: 180 }, { x: 370, y: 280 }, { x: 30, y: 280 }];
  const pts = [];
  let n = 0;
  for (let gx = 0; gx < 4; gx++) {
    for (let gy = 0; gy < 2; gy++) {
      n += 1;
      pts.push({
        id: 'pt-' + n, floorId: canvasId, index: n,
        x: 60 + gx * 90, y: 60 + gy * 70,
        value: 9.0 - gx * 0.4 - gy * 0.3,
        isBasePoint: n === 1, label: n === 1 ? 'BP1' : String(n), createdAt: Date.now(),
      });
    }
  }
  for (let gx = 0; gx < 4; gx++) {
    for (let gy = 0; gy < 2; gy++) {
      n += 1;
      pts.push({
        id: 'pt-' + n, floorId: canvasId, index: n,
        x: 60 + gx * 90, y: 205 + gy * 50,
        // Sloped to drain: a far steeper fall than the house has.
        value: 9.0 - gx * 1.6 - gy * 1.2,
        isBasePoint: false, label: String(n), createdAt: Date.now(),
      });
    }
  }
  rec.floorSurvey.byCanvasId[canvasId] = {
    canvasId,
    boundary: house,
    areas: [
      { id: 'area-house', name: 'Main', polygon: house, createdAt: Date.now() },
      { id: 'area-garage', name: 'Garage', polygon: garage, createdAt: Date.now() },
    ],
    points: pts,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await window.ToolboxDB.saveCustomerFile(rec);
  return { id, canvasId };
}, planImg);

await page.goto(BASE + `#/file/${e2eSeed.id}`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 700));
const openedFloor = await page.evaluate(() => {
  const el = document.querySelector('[data-app="floor"]');
  if (el) el.click();
  return !!el;
});
check('Floor Survey opened', openedFloor);
await new Promise((r) => setTimeout(r, 5000));

// Into Topo, then B&W lines, then send.
const sent = await page.evaluate(async () => {
  const clickText = (needle) => {
    const all = Array.from(document.querySelectorAll('button, [role="tab"], a'));
    const hit = all.find((b) => (b.textContent || '').trim().toLowerCase() === needle);
    if (hit) { hit.click(); return true; }
    return false;
  };
  // The mode toggle labels the topo side "Topo".
  clickText('topo');
  await new Promise((r) => setTimeout(r, 1200));
  // Open the Contours panel.
  const waves = Array.from(document.querySelectorAll('button')).find(
    (b) => (b.getAttribute('title') || b.getAttribute('aria-label') || '').toLowerCase().includes('contour'),
  );
  if (waves) waves.click();
  await new Promise((r) => setTimeout(r, 600));
  const select = Array.from(document.querySelectorAll('select')).find((el) =>
    Array.from(el.options || []).some((o) => o.value === 'contour-bw'),
  );
  if (!select) return { error: 'no mode select found' };
  select.value = 'contour-bw';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 900));
  const send = Array.from(document.querySelectorAll('button')).find(
    (b) => /send to distress survey/i.test(b.textContent || ''),
  );
  if (!send) return { error: 'no send button on B&W lines' };
  // Choose the house, leaving the garage out. A garage is sloped to drain,
  // so its contours are the steepest thing on the drawing and say nothing
  // about the house.
  const area = Array.from(document.querySelectorAll('select')).find((el) =>
    Array.from(el.options || []).some((o) => /garage/i.test(o.textContent || '')),
  );
  if (!area) return { error: 'no boundary selector found' };
  const house = Array.from(area.options).find((o) => /main/i.test(o.textContent || ''));
  if (!house) return { error: 'no house boundary in the selector' };
  area.value = house.value;
  area.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 900));
  send.click();
  // Composing and writing a 3000px PNG takes a moment.
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 400));
    const label = Array.from(document.querySelectorAll('p')).find((p) =>
      /^Sent |Could not|No contours/.test(p.textContent || ''),
    );
    if (label) return { message: label.textContent.trim() };
  }
  return { error: 'the send never reported back' };
});
check('The send action is offered on B&W lines and reports back', !sent.error, sent.error || sent.message);
check('It reported success', /^Sent /.test(sent.message || ''), sent.message || '');
check(
  'It names the boundary it sent, not just "sent"',
  /Sent Main\./.test(sent.message || ''),
  sent.message || '',
);

const written = await page.evaluate(async (seed) => {
  const rec = await window.ToolboxDB.getCustomerFile(seed.id);
  const canvas = window.ToolboxPlanSetup.canvasById(rec, seed.canvasId);
  const layer = window.ToolboxPlanSetup.contourLayer(canvas);
  if (!layer) return { layer: null };
  const dataUrl = await window.ToolboxDB.getMedia(layer.id);
  if (!dataUrl) return { layer, bytes: false };

  // Read the picture back and look at it.
  const probe = await new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      let clear = 0;
      let ink = 0;
      let coloured = 0;
      let upperInk = 0;
      let lowerInk = 0;
      // The garage sits below 170/300 of the plan; the house above it.
      const splitRow = Math.round(c.height * (170 / 300));
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a === 0) { clear += 1; continue; }
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const dark = r < 120 && g < 120 && b < 120;
        if (dark) {
          ink += 1;
          const row = Math.floor((i / 4) / c.width);
          if (row < splitRow) upperInk += 1; else lowerInk += 1;
        }
        // A colour-fill palette would show up as a strong channel spread.
        if (Math.max(r, g, b) - Math.min(r, g, b) > 40) coloured += 1;
      }
      const total = data.length / 4;
      // The corner outside the boundary must be clear through, or the layer
      // would hide the plan under it.
      const cornerAlpha = data[3];
      res({
        w: img.naturalWidth,
        h: img.naturalHeight,
        clearFraction: clear / total,
        inkFraction: ink / total,
        colouredFraction: coloured / total,
        upperInk,
        lowerInk,
        cornerAlpha,
      });
    };
    img.onerror = () => res(null);
    img.src = dataUrl;
  });
  return {
    layer,
    bytes: true,
    aspect: layer.width / layer.height,
    planW: canvas.plan.width,
    planH: canvas.plan.height,
    probe,
  };
}, e2eSeed);

check('A layer is on the level now', !!written.layer);
if (written.layer && written.probe) {
  check(
    'It records the plan extent, so the pins line up',
    written.layer.width === written.planW && written.layer.height === written.planH,
    `${written.layer.width}x${written.layer.height} vs plan ${written.planW}x${written.planH}`,
  );
  check(
    'The picture has the plan aspect ratio',
    Math.abs(written.probe.w / written.probe.h - written.planW / written.planH) < 0.01,
    `${written.probe.w}x${written.probe.h}`,
  );
  check(
    'It is transparent, not painted on white',
    written.probe.clearFraction > 0.5,
    'clear ' + (written.probe.clearFraction * 100).toFixed(1) + '%',
  );
  check(
    'The corner outside the boundary is clear through',
    written.probe.cornerAlpha === 0,
    'alpha ' + written.probe.cornerAlpha,
  );
  check(
    'There are contour lines in it',
    written.probe.inkFraction > 0.0005,
    'ink ' + (written.probe.inkFraction * 100).toFixed(3) + '%',
  );
  check(
    'And they are black and white, not a colour fill',
    written.probe.colouredFraction < 0.01,
    'coloured ' + (written.probe.colouredFraction * 100).toFixed(3) + '%',
  );
  check(
    'The survey date came with it',
    written.layer.surveyDate === '2026-10-10',
    String(written.layer.surveyDate),
  );
  check(
    'The layer records which boundary it covers',
    written.layer.areaName === 'Main',
    String(written.layer.areaName),
  );
  // The garage sits in the lower third of the plan. If the selected boundary
  // were ignored, its steep contours would be the densest ink on the sheet.
  check(
    'The boundary left out is not in the picture',
    written.probe.lowerInk === 0,
    'ink below the house: ' + written.probe.lowerInk,
  );
  check(
    'The boundary chosen is',
    written.probe.upperInk > 0,
    'ink in the house: ' + written.probe.upperInk,
  );
}

// And Distress shows that real one.
await page.goto(BASE + `#/file/${e2eSeed.id}`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 800));
await page.evaluate(() => {
  const el = document.querySelector('[data-app="distress"]');
  if (el) el.click();
});
await new Promise((r) => setTimeout(r, 3500));
const fr3 = page.frames().find((f) => /distress-survey\/survey\.html/.test(f.url()));
if (fr3) {
  await fr3.waitForSelector('body.host-mode #stage', { timeout: 15000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1200));
  const live = await fr3.evaluate(() => {
    window.setLayerView('both');
    const plan = document.getElementById('planLayerImage');
    const contour = document.getElementById('contourLayerImage');
    return {
      pill: !(document.getElementById('layerPill') || {}).hidden,
      both: !!plan && !!contour &&
        plan.getAttribute('visibility') !== 'hidden' &&
        contour.getAttribute('visibility') !== 'hidden',
      // Both images cover the same box, which is the alignment.
      sameBox: !!plan && !!contour &&
        plan.getAttribute('width') === contour.getAttribute('width') &&
        plan.getAttribute('height') === contour.getAttribute('height') &&
        plan.getAttribute('x') === contour.getAttribute('x') &&
        plan.getAttribute('y') === contour.getAttribute('y'),
    };
  });
  check('Distress offers the real layer', live.pill);
  check('Plan and contour show together', live.both);
  check('The two layers occupy the same box', live.sameBox);
}

check('No JavaScript errors throughout', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) process.exitCode = 1;
