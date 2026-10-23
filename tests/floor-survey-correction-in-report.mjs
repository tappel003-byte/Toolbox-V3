/**
 * A corrected reading is corrected everywhere, and never stored as raw.
 *
 * Run: node tests/floor-survey-correction-in-report.mjs   (static server on 8765)
 *
 * Tim's design, which this protects rather than changes:
 *   - Data Collection shows the RAW reading and its correction separately.
 *   - The topo shows the NORMALIZED reading: raw plus the correction.
 *   - Stored measurement values stay RAW. transitions and
 *     transitionGroupAverages stay separate from them.
 *
 * Two connected defects, found by an independent review of the code:
 *
 * 1. The composed still did not normalize. ReportTopoWorkspace hands TopoTab
 *    corrected points, so the LIVE drawing is right -- but
 *    composeReportTopoFigureForPage read layer.points straight off storage,
 *    raw, and Print composes a still for every floor slide. A house with a
 *    flooring transition therefore showed one set of readings on screen and
 *    another in the PDF, under a cover that says "Corrected for Flooring
 *    Differences".
 *
 * 2. Moving a reading label wrote the normalized value back into storage.
 *    TopoTab's commitLabelMove, undoLastMove and resetAllLabelPositions each
 *    took a point out of the array they were GIVEN -- the corrected one --
 *    and handed the whole thing to savePoint, which replaces the stored
 *    point including its value. A label's position is where a number sits on
 *    the drawing; it is not the number.
 *
 * The second is why the two belong together: correcting the still while
 * labels can still write corrected values back would correct a value that
 * had already been corrected once on disk.
 *
 * The correction maths is NOT exercised here as a thing to verify -- it is
 * the fixture's own arithmetic, computed independently in this file, so a
 * change to the product's formula would show up as a failure rather than
 * being silently agreed with.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const BASE = 'http://127.0.0.1:8765/index.html';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const near = (a, b, tol = 0.02) => typeof a === 'number' && typeof b === 'number'
  && Math.abs(a - b) <= tol;

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const p = await browser.newPage();
p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await p.setViewport({ width: 1640, height: 1000, deviceScaleFactor: 1 });
await p.goto(BASE, { waitUntil: 'networkidle0' });

/**
 * One level, one boundary, twelve readings.
 *
 *   - T1 is a tile-to-carpet transition: readingA 9.0 on the reference side,
 *     readingB 7.7 on the other, so its delta is +1.3.
 *   - Six readings sit downstream of it and carry its id.
 *   - One of those six is the transition ANCHOR, which is never corrected.
 *   - The remaining six carry no transition and are never corrected.
 *
 * So the corrected high is 1.3 above the raw high, and the low is unmoved --
 * which is exactly the shape the independent review reproduced.
 */
const DELTA = 1.3;
async function seed(id, withTransition) {
  return p.evaluate(async (fid, useTransition, delta) => {
    const plan = (() => {
      const c = document.createElement('canvas'); c.width = 1200; c.height = 900;
      const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, 1200, 900);
      x.strokeStyle = '#111'; x.lineWidth = 6; x.strokeRect(30, 30, 1140, 840);
      return c.toDataURL('image/jpeg', 0.9);
    })();
    const rec = window.ToolboxApp.blankCustomerFile(fid);
    window.ToolboxPlanSetup.ensurePlanSetup(rec);
    rec.firstName = 'Correction'; rec.lastName = 'Fixture';
    rec.propertyAddress = '15 Rabbitbrush\nSanta Fe County, NM 87506';
    const cv = rec.planSetup.canvases[0];
    cv.name = 'Main Level';
    await window.ToolboxDB.putMedia('plan-corr-' + fid, plan);
    cv.plan = { id: 'plan-corr-' + fid, width: 1200, height: 900 };
    cv.frontDoorFacing = 'E';
    const poly = [{ x: 40, y: 40 }, { x: 1160, y: 40 },
      { x: 1160, y: 860 }, { x: 40, y: 860 }];

    // Raw readings. The six downstream ones are the LOWER half, so applying
    // +1.3 to them moves the HIGH and leaves the LOW alone only if we make
    // one of them the top. Lay them out explicitly instead of by formula so
    // the expected numbers in this file are readable.
    const raw = [
      { id: 'c1', v: 7.0 }, { id: 'c2', v: 7.4 }, { id: 'c3', v: 7.8 },
      { id: 'c4', v: 8.2 }, { id: 'c5', v: 8.6 }, { id: 'c6', v: 8.8 },
      { id: 'd1', v: 7.2 }, { id: 'd2', v: 7.6 }, { id: 'd3', v: 8.0 },
      { id: 'd4', v: 8.4 }, { id: 'd5', v: 8.7 }, { id: 'd6', v: 8.8 },
    ];
    const points = raw.map((r, i) => {
      const pt = {
        id: r.id, floorId: cv.id, index: i + 1,
        x: 120 + (i % 4) * 300, y: 150 + Math.floor(i / 4) * 280,
        value: r.v,
      };
      if (useTransition && r.id[0] === 'd') {
        pt.transitionId = 't1';
        // d1 is the anchor: captured ON the reference surface, never moved.
        if (r.id === 'd1') pt.isTransitionAnchor = true;
      }
      return pt;
    });
    const layer = {
      canvasId: cv.id, points,
      areas: [{ id: 'a0', name: 'Main Level', polygon: poly, createdAt: 1 }],
      boundary: poly,
    };
    if (useTransition) {
      layer.transitions = [{
        id: 't1', x: 600, y: 450,
        surfaceA: 'Tile', surfaceB: 'Carpet',
        readingA: 9.0, readingB: 9.0 - delta,   // delta = readingA - readingB
        createdAt: 1,
      }];
      layer.transitionGroupAverages = {};
    }
    rec.floorSurvey = { id: 'fs-' + fid, inspectionDate: '2026-10-09',
      byCanvasId: { [cv.id]: layer } };
    await window.ToolboxDB.saveCustomerFile(rec);
    return { canvasId: cv.id };
  }, id, withTransition, DELTA);
}

/** What the fixture says the numbers should be, computed here, not borrowed. */
function expected(withTransition) {
  const raw = [7.0, 7.4, 7.8, 8.2, 8.6, 8.8, 7.2, 7.6, 8.0, 8.4, 8.7, 8.8];
  const ids = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6'];
  const vals = raw.map((v, i) => {
    const id = ids[i];
    if (!withTransition) return v;
    if (id[0] !== 'd') return v;
    if (id === 'd1') return v;              // the anchor is never corrected
    return Math.round((v + DELTA) * 100) / 100;
  });
  const hi = Math.max(...vals), lo = Math.min(...vals);
  return { hi, lo, delta: Math.round((hi - lo) * 100) / 100, vals };
}

const composed = (fid, canvasId) => p.evaluate(async (f, cid) => {
  const rec = await window.ToolboxDB.getCustomerFile(f);
  const out = await window.ToolboxFloorSurvey.composeReportTopoFigureForPage(
    rec, { canvasId: cid, epochId: 'fs-' + f, areaId: null, scope: 'all' },
    window.ToolboxDB.getMedia.bind(window.ToolboxDB),
  );
  if (!out) return null;
  const s = (out.stats || [])[0] || null;
  return s ? { hi: s.hi, lo: s.lo, delta: Math.round(s.delta * 100) / 100 } : null;
}, fid, canvasId);

const storedPins = (fid, canvasId) => p.evaluate(async (f, cid) => {
  const l = (await window.ToolboxDB.getCustomerFile(f)).floorSurvey.byCanvasId[cid];
  return { highPinDx: l.highPinDx ?? null, highPinDy: l.highPinDy ?? null,
    lowPinDx: l.lowPinDx ?? null, lowPinDy: l.lowPinDy ?? null };
}, fid, canvasId);

const storedValues = (fid, canvasId) => p.evaluate(async (f, cid) => {
  const rec = await window.ToolboxDB.getCustomerFile(f);
  const layer = rec.floorSurvey.byCanvasId[cid];
  return layer.points.map((pt) => ({
    id: pt.id, value: pt.value,
    transitionId: pt.transitionId || null,
    anchor: !!pt.isTransitionAnchor,
    labelDx: pt.labelDx === undefined ? null : pt.labelDx,
    labelDy: pt.labelDy === undefined ? null : pt.labelDy,
  }));
}, fid, canvasId);

// ---------------------------------------------- control: no transitions
{
  const { canvasId } = await seed('corr-none', false);
  const want = expected(false);
  const got = await composed('corr-none', canvasId);
  check('no transitions: the composed still reports the raw readings',
    !!got && near(got.hi, want.hi) && near(got.lo, want.lo) && near(got.delta, want.delta),
    JSON.stringify({ want, got }));
}

// --------------------------------------- the defect: a real transition
const { canvasId } = await seed('corr-t1', true);
const wantCorrected = expected(true);
const wantRaw = expected(false);

check('the fixture actually moves the numbers',
  !near(wantCorrected.hi, wantRaw.hi),
  `raw high ${wantRaw.hi} vs corrected high ${wantCorrected.hi}`);

const still = await composed('corr-t1', canvasId);
check('the composed still reports NORMALIZED readings, not raw',
  !!still && near(still.hi, wantCorrected.hi) && near(still.lo, wantCorrected.lo)
  && near(still.delta, wantCorrected.delta),
  JSON.stringify({ expectedCorrected: wantCorrected, expectedRaw: wantRaw, still }));

const beforeAnything = await storedValues('corr-t1', canvasId);
check('and composing it changed nothing in storage',
  JSON.stringify(beforeAnything.map((q) => q.value)) ===
  JSON.stringify(wantRaw.vals),
  JSON.stringify(beforeAnything.map((q) => q.value)));

check('the transition anchor is not corrected',
  (() => {
    const d1 = beforeAnything.find((q) => q.id === 'd1');
    return d1 && d1.anchor && near(d1.value, 7.2);
  })(),
  JSON.stringify(beforeAnything.find((q) => q.id === 'd1')));

// ------------------------------- override and group average still flow
{
  await p.evaluate(async (f, cid) => {
    const rec = await window.ToolboxDB.getCustomerFile(f);
    const layer = rec.floorSurvey.byCanvasId[cid];
    layer.transitions[0].manualDeltaOverride = 0.5;
    await window.ToolboxDB.saveCustomerFile(rec);
  }, 'corr-t1', canvasId);
  const withOverride = await composed('corr-t1', canvasId);
  // d6 raw 8.8 + 0.5 = 9.3 becomes the high; c6/d6 raw high was 8.8.
  check('a manual delta override is honoured by the composed still',
    !!withOverride && near(withOverride.hi, 9.3),
    JSON.stringify(withOverride));
  await p.evaluate(async (f, cid) => {
    const rec = await window.ToolboxDB.getCustomerFile(f);
    const t = rec.floorSurvey.byCanvasId[cid].transitions[0];
    delete t.manualDeltaOverride;
    t.useGroupAverage = true;
    // transitionGroupKey() joins the two surfaces with an arrow.
    rec.floorSurvey.byCanvasId[cid].transitionGroupAverages = { 'Tile\u2192Carpet': 0.9 };
    await window.ToolboxDB.saveCustomerFile(rec);
  }, 'corr-t1', canvasId);
  const withGroup = await composed('corr-t1', canvasId);
  check('a group average is honoured by the composed still',
    !!withGroup && near(withGroup.hi, 9.7),
    JSON.stringify(withGroup));
  await p.evaluate(async (f, cid) => {
    const rec = await window.ToolboxDB.getCustomerFile(f);
    const t = rec.floorSurvey.byCanvasId[cid].transitions[0];
    delete t.useGroupAverage;
    rec.floorSurvey.byCanvasId[cid].transitionGroupAverages = {};
    await window.ToolboxDB.saveCustomerFile(rec);
  }, 'corr-t1', canvasId);
}

// --------------- the label-position write-back, driven through the UI
await p.goto(`${BASE}#/file/corr-t1/report`, { waitUntil: 'networkidle0' });
await p.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 9000));
await p.evaluate(() => {
  const t = [...document.querySelectorAll('.rb-thumb[data-page-id]')]
    .find((x) => /floor|main level/i.test(x.getAttribute('aria-label') || ''));
  if (t) t.click();
});
await new Promise((r) => setTimeout(r, 5000));

// Give two readings a label offset first, so Reset has something to clear.
await p.evaluate(async (f, cid) => {
  const rec = await window.ToolboxDB.getCustomerFile(f);
  const layer = rec.floorSurvey.byCanvasId[cid];
  layer.points.forEach((pt) => {
    if (pt.id === 'd2' || pt.id === 'd5') { pt.labelDx = 12; pt.labelDy = -8; }
  });
  // High/Low pin offsets too. Reset clears BOTH, and it used to do that as
  // two unawaited whole-record writes that raced -- the floor one read the
  // record before the label one landed and put the old labels back.
  layer.highPinDx = 33; layer.highPinDy = 22;
  layer.lowPinDx = -11; layer.lowPinDy = 5;
  await window.ToolboxDB.saveCustomerFile(rec);
}, 'corr-t1', canvasId);
await p.reload({ waitUntil: 'networkidle0' });
await p.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 9000));
await p.evaluate(() => {
  const t = [...document.querySelectorAll('.rb-thumb[data-page-id]')]
    .find((x) => /floor|main level/i.test(x.getAttribute('aria-label') || ''));
  if (t) t.click();
});
await new Promise((r) => setTimeout(r, 5000));

const beforeReset = await storedValues('corr-t1', canvasId);
check('two readings carry a label offset before the reset',
  beforeReset.filter((q) => q.labelDx !== null).length === 2,
  JSON.stringify(beforeReset.filter((q) => q.labelDx !== null)));

// The control lives in a collapsed <details> inside Floor Survey's own
// panel, so open the panels before looking for it. This is the real control
// and a real click; nothing about the handler is stubbed.
await p.evaluate(() => {
  document.querySelectorAll('details').forEach((d) => { d.open = true; });
  // Floor Survey's panel groups its controls behind tabs; the label controls
  // are behind the one that says so.
  [...document.querySelectorAll('button')]
    .filter((b) => /^(labels?|points?|markers?)$/i.test((b.textContent || '').trim()))
    .slice(0, 3)
    .forEach((b) => { try { b.click(); } catch (_) { /* not a tab */ } });
  document.querySelectorAll('details').forEach((d) => { d.open = true; });
});
await new Promise((r) => setTimeout(r, 1500));
const clicked = await p.evaluate(() => {
  const btn = [...document.querySelectorAll('button')]
    .find((b) => /reset label positions/i.test(b.textContent || ''));
  if (!btn) return { found: false };
  btn.click();
  return { found: true };
});
await new Promise((r) => setTimeout(r, 2500));
const afterReset = await storedValues('corr-t1', canvasId);

check('the Reset label positions control was found and clicked',
  clicked.found, JSON.stringify(clicked));
check('resetting label positions leaves every stored reading RAW',
  JSON.stringify(afterReset.map((q) => q.value)) === JSON.stringify(wantRaw.vals),
  JSON.stringify({ expected: wantRaw.vals, got: afterReset.map((q) => q.value) }));
check('and it clears the offsets it was supposed to clear',
  afterReset.filter((q) => q.labelDx !== null).length === 0,
  JSON.stringify(afterReset.filter((q) => q.labelDx !== null)));
const pinsAfter = await storedPins('corr-t1', canvasId);
check('and clears the High and Low pin offsets in the same operation',
  pinsAfter.highPinDx === null && pinsAfter.highPinDy === null &&
  pinsAfter.lowPinDx === null && pinsAfter.lowPinDy === null,
  JSON.stringify(pinsAfter));
check('and leaves the transition association alone',
  afterReset.filter((q) => q.transitionId === 't1').length === 6 &&
  afterReset.filter((q) => q.anchor).length === 1,
  JSON.stringify(afterReset.filter((q) => q.transitionId).map((q) => q.id)));

// GPT-004's delayed-host-save counterexample.
//
// The host persists on onFloorChange -- ReportTopoWorkspace's handleFloor
// calls saveFloor -- so the reset is TWO whole-record writes unless the host
// is told after the reset has landed. Under ordinary timing the order hides
// it. Holding the first write and releasing it last is what exposes it.
//
// The offsets are seeded and the page RELOADED first, because the component
// decides whether to touch the pins from the floor it has in memory: seeding
// storage mid-session leaves pinsSet false and the second write never starts.
await p.evaluate(async (f, cid) => {
  const rec = await window.ToolboxDB.getCustomerFile(f);
  const layer = rec.floorSurvey.byCanvasId[cid];
  layer.points.forEach((pt) => {
    if (pt.id === 'd2' || pt.id === 'd5') { pt.labelDx = 12; pt.labelDy = -8; }
  });
  layer.highPinDx = 33; layer.highPinDy = 22;
  layer.lowPinDx = -11; layer.lowPinDy = 5;
  await window.ToolboxDB.saveCustomerFile(rec);
}, 'corr-t1', canvasId);
await p.reload({ waitUntil: 'networkidle0' });
await p.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 9000));
await p.evaluate(() => {
  const t = [...document.querySelectorAll('.rb-thumb[data-page-id]')]
    .find((x) => /floor|main level/i.test(x.getAttribute('aria-label') || ''));
  if (t) t.click();
});
await new Promise((r) => setTimeout(r, 5000));

const delayed = await p.evaluate(async (f, cid) => {
  const db = window.ToolboxDB;
  const real = db.saveCustomerFile.bind(db);
  let held = null;
  let writes = 0;
  db.saveCustomerFile = function (rec) {
    writes += 1;
    if (writes === 1) {
      return new Promise((resolve) => { held = () => real(rec).then(resolve); });
    }
    return real(rec);
  };
  document.querySelectorAll('details').forEach((d) => { d.open = true; });
  [...document.querySelectorAll('button')]
    .filter((b) => /^(labels?|points?|markers?)$/i.test((b.textContent || '').trim()))
    .slice(0, 3).forEach((b) => { try { b.click(); } catch (_) { /* not a tab */ } });
  document.querySelectorAll('details').forEach((d) => { d.open = true; });
  await new Promise((r) => setTimeout(r, 400));
  const btn = [...document.querySelectorAll('button')]
    .find((b) => /reset label positions/i.test(b.textContent || ''));
  if (!btn) { db.saveCustomerFile = real; return { none: true }; }
  btn.click();
  await new Promise((r) => setTimeout(r, 1500));
  if (held) await held();                  // release the FIRST write last
  await new Promise((r) => setTimeout(r, 1500));
  db.saveCustomerFile = real;
  const after = await db.getCustomerFile(f);
  const layer = after.floorSurvey.byCanvasId[cid];
  return {
    writes,
    offsets: layer.points.filter((pt) => pt.labelDx !== undefined).map((pt) => pt.id),
    pins: [layer.highPinDx, layer.highPinDy, layer.lowPinDx, layer.lowPinDy]
      .filter((v) => v !== undefined && v !== null).length,
    values: layer.points.map((pt) => pt.value),
    transitions: (layer.transitions || []).length,
  };
}, 'corr-t1', canvasId);

check('the delayed-write fixture reached the reset control',
  !delayed.none, JSON.stringify(delayed));
check('reset holds up when a write started before it finishes last',
  !delayed.none && delayed.offsets.length === 0 && delayed.pins === 0,
  JSON.stringify(delayed));
check('and that ordering never touches the readings or the transitions',
  !delayed.none &&
  JSON.stringify(delayed.values) === JSON.stringify(wantRaw.vals) &&
  delayed.transitions === 1,
  JSON.stringify({ values: delayed.values, transitions: delayed.transitions }));

// ------------------- reopen: corrected exactly once, never twice
await p.reload({ waitUntil: 'networkidle0' });
await p.waitForFunction(() => !!document.querySelector('.rb-sheet'), { timeout: 40000 });
await new Promise((r) => setTimeout(r, 9000));
const afterReopen = await composed('corr-t1', canvasId);
check('reopened, the still is corrected exactly once',
  !!afterReopen && near(afterReopen.hi, wantCorrected.hi),
  JSON.stringify({ once: wantCorrected.hi,
    twice: Math.round((wantCorrected.hi + DELTA) * 100) / 100, got: afterReopen }));

// ------------------------------------------- the printed page
await p.evaluate(() => { window.print = () => { window.__printed = true; }; });
await p.click('#rb-print');
await p.waitForFunction(() => window.__printed === true, { timeout: 90000 });
await new Promise((r) => setTimeout(r, 1500));
const paper = await p.evaluate(() => {
  const sheets = [...document.querySelectorAll('.rb-print .rb-sheet')];
  const floor = sheets.find((s) => s.getAttribute('data-page-type') === 'floor');
  return floor ? { own: [floor.clientWidth, floor.clientHeight], n: sheets.length } : null;
});
check('the printed floor sheet is 11x17 landscape at 96dpi',
  !!paper && paper.own[0] === 1632 && paper.own[1] === 1056,
  JSON.stringify(paper));
const afterPrint = await storedValues('corr-t1', canvasId);
check('printing leaves every stored reading raw and untouched',
  JSON.stringify(afterPrint.map((q) => q.value)) === JSON.stringify(wantRaw.vals),
  JSON.stringify(afterPrint.map((q) => q.value)));

// ---------------- the contour layer must not be corrected a second time
{
  const layerStats = await p.evaluate(async (f, cid) => {
    const rec = await window.ToolboxDB.getCustomerFile(f);
    const layer = rec.floorSurvey.byCanvasId[cid];
    const floor = {
      id: cid, projectId: f, name: 'Main Level', order: 0,
      planWidth: 1200, planHeight: 900,
      boundary: layer.boundary, areas: layer.areas,
      transitions: layer.transitions,
      transitionGroupAverages: layer.transitionGroupAverages,
    };
    // Corrected points, exactly as TopoTab is handed them, straight into the
    // GENERIC composer -- the path contour-layer.ts takes.
    const corrected = layer.points.map((pt) => {
      if (!pt.transitionId || pt.isTransitionAnchor) return pt;
      const t = (layer.transitions || []).find((x) => x.id === pt.transitionId);
      if (!t) return pt;
      return { ...pt, value: Math.round((pt.value + (t.readingA - t.readingB)) * 100) / 100 };
    });
    const out = await window.ToolboxFloorSurvey.composeReportTopoFigure({
      floor, points: corrected, areaId: null,
      extent: { x: 0, y: 0, w: 1200, h: 900 }, background: 'transparent',
    });
    const s = out && (out.stats || [])[0];
    return s ? { hi: s.hi, lo: s.lo } : null;
  }, 'corr-t1', canvasId);
  check('the generic composer does NOT correct points it is handed corrected',
    !!layerStats && near(layerStats.hi, wantCorrected.hi),
    JSON.stringify({ correctedOnce: wantCorrected.hi,
      correctedTwice: Math.round((wantCorrected.hi + DELTA) * 100) / 100,
      got: layerStats }));
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
