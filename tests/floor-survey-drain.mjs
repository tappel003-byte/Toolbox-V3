/**
 * A reading can be tagged as a floor drain from the keypad's "Reading ▾" menu. A drain reading keeps its
 * number and its value on the plan, and stays out of the contours, the High / Low and the readings range.
 * (Tim, Nov 13, 2026: a vet's kennel floor drains are cast low on purpose and skew the topo.)
 *
 * Real mouse and keyboard on a phone-sized screen. Run: node tests/floor-survey-drain.mjs
 */
import { createRequire } from 'module';
import { spawn } from 'child_process';
import net from 'net';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch { puppeteer = require('/tmp/node_modules/puppeteer-core'); }

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const port = await new Promise((resolve, reject) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port: p } = s.address(); s.close(() => resolve(p)); });
  s.on('error', reject);
});
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' });
const BASE = `http://127.0.0.1:${port}/index.html`;
for (let i = 0; i < 100; i += 1) { try { if ((await fetch(BASE)).ok) break; } catch (_) {} await wait(100); }

const FILE = 'fs-drain';
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome-stable', headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('dialog', async (d) => { await d.accept(); });
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: false });
await page.goto(BASE, { waitUntil: 'networkidle0' });

// A level with a boundary, a base point and six ordinary readings between 5.3 and 6.2 inches.
await page.evaluate(async (id) => {
  const c = document.createElement('canvas'); c.width = 800; c.height = 600;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 800, 600); x.strokeStyle = '#111'; x.strokeRect(20, 20, 760, 560);
  await ToolboxDB.putMedia('plan-drain', c.toDataURL('image/jpeg', 0.9));
  const rec = ToolboxApp.blankCustomerFile(id); ToolboxPlanSetup.ensurePlanSetup(rec);
  rec.firstName = 'Drain'; rec.lastName = 'Test'; rec.propertyAddress = '1 Kennel Way';
  const cv = rec.planSetup.canvases[0]; cv.name = 'Main Level'; cv.plan = { id: 'plan-drain', width: 800, height: 600 };
  const poly = [{ x: 40, y: 40 }, { x: 760, y: 40 }, { x: 760, y: 560 }, { x: 40, y: 560 }];
  const mk = (n, px, py, v, extra) => ({ id: 'p' + n, floorId: cv.id, index: n, x: px, y: py, value: v, createdAt: n, ...(extra || {}) });
  const points = [
    mk(1, 120, 120, 6.0, { isBasePoint: true, label: 'BP1' }), mk(2, 300, 140, 5.4), mk(3, 520, 150, 5.8), mk(4, 700, 160, 6.2),
    mk(5, 160, 460, 5.3), mk(6, 420, 480, 5.7), mk(7, 680, 470, 6.1),
  ];
  rec.floorSurvey = { id: 'fs-' + id, inspectionDate: '2026-11-13', byCanvasId: { [cv.id]: { canvasId: cv.id, points, areas: [{ id: 'a1', name: 'Main Level', polygon: poly, createdAt: 1 }], boundary: poly } } };
  await ToolboxDB.saveCustomerFile(rec);
}, FILE);

const stored = () => page.evaluate(async (id) => {
  const r = await ToolboxDB.getCustomerFile(id);
  const layer = Object.values(r.floorSurvey.byCanvasId)[0];
  return { points: layer.points, layer, canvasId: Object.keys(r.floorSurvey.byCanvasId)[0] };
}, FILE);
async function openSurvey() {
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.goto(`${BASE}#/file/${FILE}/floor`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[aria-label^="Elevation stats"]', { timeout: 30000 });
  await wait(1200);
}
// Tap the plan at a place given as a fraction of the plan image (800 x 600); finds the plan canvas on screen.
async function tapPlan(fx, fy) {
  const box = await page.evaluate(() => {
    const area = document.querySelector('[data-plan-area]');
    const cs = [...area.querySelectorAll('canvas')].map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return { l: cs.left, t: cs.top, w: cs.width, h: cs.height };
  });
  await page.mouse.click(box.l + box.w * fx, box.t + box.h * fy);
  await wait(500);
}
const kindMenu = () => page.$('[data-keypad-kind]');
const chipText = () => page.evaluate(() => document.querySelector('[aria-label^="Elevation stats"]').innerText.replace(/\s+/g, ' '));

await openSurvey();
// Record what the canvases draw (text, outlined text, dashed lines) for the checks below.
await page.evaluate(() => {
  window.__txt = []; window.__dash = 0; window.__halo = [];
  const f = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (t, ...r) { window.__txt.push(String(t)); return f.call(this, t, ...r); };
  const st = CanvasRenderingContext2D.prototype.strokeText;
  CanvasRenderingContext2D.prototype.strokeText = function (t, ...r) { window.__halo.push(String(t)); return st.call(this, t, ...r); };
  const d = CanvasRenderingContext2D.prototype.setLineDash;
  CanvasRenderingContext2D.prototype.setLineDash = function (arr) { if (arr && arr.length) window.__dash += 1; return d.call(this, arr); };
});

// ---- a normal reading: the menu is there, on Reading
await tapPlan(0.45, 0.5);
const first = await kindMenu();
check('The keypad has a "Reading" menu in its upper-left', !!first);
const firstBox = first ? await first.boundingBox() : null;
const padBox = await page.evaluate(() => { const r = document.querySelector('.rounded-t-2xl').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width }; });
check('and it sits in the keypad\'s upper-left, above the number', firstBox && firstBox.x < padBox.l + padBox.w / 2 && firstBox.y < padBox.t + 70, JSON.stringify({ firstBox, padBox }));
check('It starts on "Reading"', await page.$eval('[data-keypad-kind]', (el) => el.value === 'reading'));
const optionNames = await page.$$eval('[data-keypad-kind] option', (o) => o.map((x) => x.textContent));
check('Its special cases are Drain and Watch', JSON.stringify(optionNames) === JSON.stringify(['Reading', 'Drain', 'Watch']), JSON.stringify(optionNames));
await page.keyboard.type('5.9'); await page.keyboard.press('Enter'); await wait(800);
let s = await stored();
const normal = s.points.find((p) => p.index === 8);
check('A normal reading saves as before, not a drain', normal && normal.value === 5.9 && !normal.special && !normal.isDrain, JSON.stringify(normal));

// ---- a drain reading, far lower than the floor
await tapPlan(0.3, 0.7);
await page.select('[data-keypad-kind]', 'drain');
check('Choosing Drain changes the menu', await page.$eval('[data-keypad-kind]', (el) => el.value === 'drain'));
await page.evaluate(() => document.querySelector('.font-mono')?.click());
await page.keyboard.type('-4.0'); await page.keyboard.press('Enter'); await wait(900);
s = await stored();
const drain = s.points.find((p) => p.index === 9);
check('A drain reading is saved with its value and the drain tag', drain && drain.value === -4 && drain.special === 'drain', JSON.stringify(drain));
check('The drain has its own number like any reading', !!drain && drain.index === 9);
const afterChip = await chipText();
check('The High / Low pill ignores the drain (no -4 in it)', !/-4|−4/.test(afterChip) && /6\.2/.test(afterChip) && /5\.3/.test(afterChip), afterChip);

// ---- the menu does not stay on Drain for the next point
await tapPlan(0.7, 0.8);
check('The next reading opens on "Reading" again', await page.$eval('[data-keypad-kind]', (el) => el.value === 'reading'));
await page.keyboard.type('5.5'); await page.keyboard.press('Enter'); await wait(800);
s = await stored();
check('and is a normal reading', !s.points.find((p) => p.index === 10)?.special);

// ---- the drain shows its number and says Drain on the plan; fixing a drain keeps the tag
await page.screenshot({ path: new URL('./review-artifacts/floor-survey-drain-plan.png', import.meta.url).pathname }).catch(() => {});
const tag = await page.evaluate(() => document.body.innerText);
void tag;
const planPt = await page.evaluate(async () => {
  const area = document.querySelector('[data-plan-area]');
  const cs = [...area.querySelectorAll('canvas')].map((c) => c.getBoundingClientRect()).sort((a, b) => b.width * b.height - a.width * a.height)[0];
  return { l: cs.left, t: cs.top, w: cs.width, h: cs.height };
});
await page.mouse.click(planPt.l + planPt.w * (240 / 800), planPt.t + planPt.h * (420 / 600));
await wait(500);
const editMenu = await kindMenu();
if (editMenu) {
  check('Tapping the drain again opens its keypad already on Drain', await page.$eval('[data-keypad-kind]', (el) => el.value === 'drain'));
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('Backspace');
  await page.keyboard.type('-4.5'); await page.keyboard.press('Enter'); await wait(800);
  s = await stored();
  const fixed = s.points.find((p) => p.index === 9);
  check('Correcting a drain keeps it a drain', fixed && fixed.special === 'drain' && fixed.value === -4.5, JSON.stringify(fixed));
  // and a drain can be turned back into an ordinary reading
  await page.mouse.click(planPt.l + planPt.w * (240 / 800), planPt.t + planPt.h * (420 / 600));
  await wait(500);
  await page.select('[data-keypad-kind]', 'reading');
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('Backspace');
  await page.keyboard.type('5.2'); await page.keyboard.press('Enter'); await wait(800);
  s = await stored();
  const back = s.points.find((p) => p.index === 9);
  check('Switching it back to Reading makes it an ordinary reading', back && !back.special && back.value === 5.2, JSON.stringify(back));
  // put it back as a drain for the surface checks
  await page.mouse.click(planPt.l + planPt.w * (240 / 800), planPt.t + planPt.h * (420 / 600));
  await wait(500);
  await page.select('[data-keypad-kind]', 'drain');
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('Backspace');
  await page.keyboard.type('-4.0'); await page.keyboard.press('Enter'); await wait(800);
} else {
  check('Tapping the drain again opens its keypad', false, 'no keypad');
}

// ---- A Watch reading from the keypad: kept, shown, not on the surface, named on the plan
await page.mouse.click(planPt.l + planPt.w * (560 / 800), planPt.t + planPt.h * (200 / 600));
await wait(500);
await page.select('[data-keypad-kind]', 'watch');
check('Choosing Watch changes the menu', await page.$eval('[data-keypad-kind]', (el) => el.value === 'watch'));
await page.keyboard.type('9.8'); await page.keyboard.press('Enter'); await wait(900);
s = await stored();
const watch = s.points.find((p) => p.special === 'watch');
check('A Watch reading is saved with its value and the watch kind', watch && watch.value === 9.8 && !watch.isDrain, JSON.stringify(watch));
const chipAfterWatch = await chipText();
check('The High / Low pill ignores the Watch reading too (9.8 is above every real reading)', !/9\.8/.test(chipAfterWatch) && /6\.2/.test(chipAfterWatch), chipAfterWatch);
// Wording for drain/watch: report compose returns specialNote for the rail;
// the PNG no longer draws the under-map line (presentation).
const noteFor = (pts) => page.evaluate(async (canvasId, id, only) => {
  const r = await ToolboxDB.getCustomerFile(id);
  const layer = r.floorSurvey.byCanvasId[canvasId];
  const floor = { id: canvasId, name: 'Main Level', boundary: layer.boundary, areas: layer.areas, exclusions: [], transitions: [], notes: [], createdAt: 1 };
  window.__halo = [];
  const keep = layer.points.filter((p) => !only || only(p));
  const out = await window.ToolboxFloorSurvey.composeReportTopoFigure({ floor, points: keep.map((p) => ({ ...p })), areaId: 'all' });
  return {
    note: out && out.specialNote,
    halo: window.__halo.filter((t) => /^\( \)/.test(t)),
  };
}, s.canvasId, FILE, pts);
const nBoth = await noteFor(null);
check('Rail note: both kinds are named when the level has both',
  nBoth.note === '( ) Drain and watch readings, not included in the topo', JSON.stringify(nBoth));
check('Report PNG: the drain/watch line is not drawn under the map',
  Array.isArray(nBoth.halo) && nBoth.halo.length === 0, JSON.stringify(nBoth.halo));
// (watch only, drain only) are computed from the figure with the other kind taken out
const monOnly = await page.evaluate(async (canvasId, id) => {
  const r = await ToolboxDB.getCustomerFile(id);
  const layer = r.floorSurvey.byCanvasId[canvasId];
  const floor = { id: canvasId, name: 'Main Level', boundary: layer.boundary, areas: layer.areas, exclusions: [], transitions: [], notes: [], createdAt: 1 };
  window.__halo = [];
  const out = await window.ToolboxFloorSurvey.composeReportTopoFigure({ floor, points: layer.points.filter((p) => !p.isDrain && p.special !== 'drain').map((p) => ({ ...p })), areaId: 'all' });
  return { note: out && out.specialNote, halo: window.__halo.filter((t) => /^\( \)/.test(t)) };
}, s.canvasId, FILE);
check('Rail note: only watch readings are named when that is all it has',
  monOnly.note === '( ) Watch readings, not included in the topo', JSON.stringify(monOnly));
// a drain saved by the earlier build (isDrain) still counts
await page.evaluate(async (id) => {
  const r = await ToolboxDB.getCustomerFile(id);
  const layer = Object.values(r.floorSurvey.byCanvasId)[0];
  const d = layer.points.find((p) => p.special === 'drain');
  delete d.special; d.isDrain = true;
  await ToolboxDB.saveCustomerFile(r);
}, FILE);
s = await stored();
const legacy = await page.evaluate(async (canvasId, id) => {
  const r = await ToolboxDB.getCustomerFile(id);
  const layer = r.floorSurvey.byCanvasId[canvasId];
  const floor = { id: canvasId, name: 'Main Level', boundary: layer.boundary, areas: layer.areas, exclusions: [], transitions: [], notes: [], createdAt: 1 };
  window.__halo = [];
  const out = await window.ToolboxFloorSurvey.composeReportTopoFigure({ floor, points: layer.points.map((p) => ({ ...p })), areaId: 'all' });
  return {
    note: out && out.specialNote,
    halo: window.__halo.filter((t) => /^\( \)|^\(-?\d/.test(t)),
    hi: out.stats[0].hi,
    lo: out.stats[0].lo,
  };
}, s.canvasId, FILE);
check('A drain saved by the earlier build (isDrain) is still a drain: ghosted, named, left out of High and Low',
  legacy.note === '( ) Drain and watch readings, not included in the topo' &&
    legacy.halo.some((t) => /^\(-?\d/.test(t)) && legacy.hi < 9 && legacy.lo > 5,
  JSON.stringify(legacy));
// Title-block rail prints the same wording.
const railNote = await page.evaluate(() => {
  const api = window.ToolboxReportRail;
  if (!api || typeof api.render !== 'function') return { ok: false, reason: 'no rail api' };
  const el = api.render({
    north: false,
    residence: 'Drain Test',
    address: '1 Kennel Way',
    title: 'Floor Level Survey\nMain Level',
    surveyDate: 'November 13, 2026',
    correctedNote: 'Corrected for flooring differences',
    stats: [{ areaId: 'a1', name: 'Main Level', hi: 6.2, lo: 5.3, delta: 0.9, decimalPlaces: 1 }],
    specialNote: '( ) Drain and watch readings, not included in the topo',
    figureLabel: 'Figure 1',
  });
  return { ok: true, text: (el && el.textContent) || '' };
});
check('Figure rail carries the drain/watch note in the title block',
  railNote.ok && /Drain and watch readings, not included in the topo/.test(railNote.text),
  JSON.stringify(railNote).slice(0, 240));
// ---- Review lists it as a drain, not counted
s = await stored();
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button, [role="tab"]')].find((x) => /^(Review|Data)/i.test((x.textContent || '').trim()));
  b?.click();
});
await wait(700);
const reviewText = await page.evaluate(() => document.body.innerText);
check('Review labels the drain reading "Drain"', /Drain/.test(reviewText));

// ---- The drain is drawn as a ghost: in parentheses, dashed outline, with its tag (capture screen)
await page.evaluate(() => { window.__txt = []; window.__dash = 0; window.__halo = []; });
await page.setViewport({ width: 380, height: 840, isMobile: true, hasTouch: false }); await wait(700);
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: false }); await wait(900);
const cap = await page.evaluate(() => ({ txt: window.__txt.slice(), dash: window.__dash, halo: window.__halo.slice() }));
check('Capture plan: the drain reading is written in parentheses, with "Drain" under it', cap.txt.some((t) => /^\(-?\d+(\.\d+)?\)$/.test(t)) && cap.txt.includes('Drain'), JSON.stringify(cap.txt.slice(0, 14)));
check('Capture plan: it has no box (no dashed outline), only type with a white outline', cap.dash === 0 && cap.halo.some((t) => /^\(-?\d/.test(t)), JSON.stringify({ dash: cap.dash, halo: cap.halo.slice(0, 4) }));
check('Capture plan: ordinary readings are not in parentheses', cap.txt.filter((t) => /^-?\d+(\.\d+)?$/.test(t)).length >= 5);

// Field Topo still draws the explanatory line under the map (report moves it to the rail).
await page.evaluate(() => {
  window.__halo = [];
  [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Topo')?.click();
});
await wait(1200);
const fieldTopo = await page.evaluate(() => window.__halo.filter((t) => /^\( \)/.test(t)));
check('Field Topo: one line under the map says what the parentheses mean',
  fieldTopo.some((t) => t === '( ) Drain and watch readings, not included in the topo'),
  JSON.stringify(fieldTopo.slice(0, 4)));
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Data')?.click();
});
await wait(400);

// ---- Report figure: the surface and the report High / Low leave the drain out
const rep = await page.evaluate(async (canvasId, id) => {
  const r = await ToolboxDB.getCustomerFile(id);
  const layer = r.floorSurvey.byCanvasId[canvasId];
  const floor = { id: canvasId, name: 'Main Level', boundary: layer.boundary, areas: layer.areas, exclusions: [], transitions: [], notes: [], createdAt: 1 };
  const withDrain = layer.points.filter((p) => p.index !== 10);
  const noDrain = withDrain.filter((p) => !(p.special || p.isDrain));
  const one = async (points) => {
    const out = await window.ToolboxFloorSurvey.composeReportTopoFigure({ floor, points: points.map((p) => ({ ...p })), areaId: 'all' });
    return out ? out.stats : null;
  };
  return { withDrain: await one(withDrain), noDrain: await one(noDrain), nWith: withDrain.length, nWithout: noDrain.length };
}, s.canvasId, FILE);
check('The report figure builds with the drain among the readings', !!rep.withDrain && !!rep.noDrain, JSON.stringify(rep).slice(0, 300));
// what the figure itself draws, with and without a drain
const figTxt = await page.evaluate(async (canvasId, id) => {
  const r = await ToolboxDB.getCustomerFile(id);
  const layer = r.floorSurvey.byCanvasId[canvasId];
  const floor = { id: canvasId, name: 'Main Level', boundary: layer.boundary, areas: layer.areas, exclusions: [], transitions: [], notes: [], createdAt: 1 };
  const run = async (points) => {
    window.__txt = []; window.__dash = 0; window.__halo = [];
    await window.ToolboxFloorSurvey.composeReportTopoFigure({ floor, points: points.map((p) => ({ ...p })), areaId: 'all' });
    return { txt: window.__txt.slice(), dash: window.__dash, halo: window.__halo.slice() };
  };
  const all = layer.points.filter((p) => p.index !== 10);
  return { withDrain: await run(all), noDrain: await run(all.filter((p) => !(p.special || p.isDrain))) };
}, s.canvasId, FILE);
check('Report figure: the drain is in parentheses with "Drain" under it, no box, type with a white outline',
  figTxt.withDrain.halo.some((t) => /^\(-?\d+(\.\d+)?\)$/.test(t)) && figTxt.withDrain.halo.includes('Drain') && figTxt.withDrain.dash === 0, JSON.stringify(figTxt.withDrain.txt.slice(0, 12)));
check('Report figure: drain/watch wording is for the rail, not drawn under the map',
  figTxt.withDrain.halo.filter((t) => t === '( ) Drain and watch readings, not included in the topo').length === 0);
check('Report figure: a level with no drain has no note and no ghost box',
  !figTxt.noDrain.halo.length && !figTxt.noDrain.txt.some((t) => /Drain|Watch/.test(t)) && figTxt.noDrain.dash === 0, JSON.stringify(figTxt.noDrain.halo));

// (The pins' place on the picture can shift because the drain, drawn outside the walls here, widens the frame.)
const same = (k) => JSON.stringify(rep.withDrain[0][k]) === JSON.stringify(rep.noDrain[0][k]);
check('Its High, Low, range and colour legend are identical with and without the drain',
  rep.withDrain && rep.noDrain && ['hi', 'lo', 'delta', 'legend'].every(same) && rep.withDrain[0].hi === 6.2 && rep.withDrain[0].lo === 5.3,
  JSON.stringify({ hi: rep.withDrain[0].hi, lo: rep.withDrain[0].lo }));

// ---- Recovery sheet label
const recLabel = await page.evaluate(() => {
  const fl = { transitions: [] };
  return {
    drain: window.ToolboxFloorSurvey.recoveryReadingLabel({ id: 'd', value: 5.3, isDrain: true }, fl),
    watch: window.ToolboxFloorSurvey.recoveryReadingLabel({ id: 'm', value: 5.3, special: 'watch' }, fl),
    normal: window.ToolboxFloorSurvey.recoveryReadingLabel({ id: 'n', value: 5.3 }, fl),
  };
});
check('The recovery sheet writes a drain (old or new) and a watch reading in parentheses and an ordinary one plain', /^\(.*5\.3.*\)$/.test(recLabel.drain) && /^\(.*5\.3.*\)$/.test(recLabel.watch) && !/\(/.test(recLabel.normal), JSON.stringify(recLabel));

// ---- Diagnostics reading summary leaves the drain out of high / low
const diag = await page.evaluate(() => {
  const pts = [
    { id: 'a', x: 100, y: 100, value: 5.5, rawValue: 5.5 }, { id: 'b', x: 200, y: 100, value: 6.1, rawValue: 6.1 },
    { id: 'c', x: 300, y: 100, value: 5.9, rawValue: 5.9 }, { id: 'd', x: 400, y: 100, value: -4, rawValue: -4, isDrain: true }, { id: 'e', x: 500, y: 100, value: 12, rawValue: 12, offSurface: true },
  ];
  const out = window.ToolboxDiagnostics.summarizeReadings({ levelName: 'L', points: pts, boundary: [], exclusions: [] });
  return { low: out.low, high: out.high, excluded: out.excludedPointCount };
});
check('Diagnostics leaves a drain and an off-surface reading out of High and Low and counts them as excluded', diag.low === 5.5 && diag.high === 6.1 && diag.excluded === 2, JSON.stringify(diag));

// ---- Explorer elevation spread
const spread = await page.evaluate(() => {
  const S = window.ToolboxExplorerSummary;
  if (!S || typeof S.elevationSpread !== 'function') return null;
  return S.elevationSpread({ points: [{ value: 6 }, { value: 5.5 }, { value: -4, isDrain: true }, { value: 12, special: 'watch' }] });
});
if (spread) check('Explorer\'s high / low for a level leaves the drain out', spread.low === 5.5 && spread.high === 6, JSON.stringify(spread));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
server.kill();
if (failed.length) process.exit(1);
