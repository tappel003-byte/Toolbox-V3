/**
 * A component says what it HOLDS, not what it is made of.
 *
 * Run: node tests/explorer-summary.mjs   (needs a static server on 8765)
 *
 * Tim, pressing Open on a Floor Survey in File Explorer and getting the
 * stored record: "who in the world is this helpful?" These are the sentences
 * that replace it, and the real archive files that go with them -- the
 * readings CSV he asked for and the pin list beside it.
 *
 * Run in a real page rather than a bare sandbox, because the corrected
 * elevation must come from Floor Survey's OWN withCorrectedValues. A second
 * implementation of the correction in the back door could disagree with the
 * topo the investigator is looking at and nothing would say which was right,
 * so the test proves the Explorer reaches the real one -- and proves what it
 * does when it cannot.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  puppeteer = require('/tmp/node_modules/puppeteer-core');
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/google-chrome-stable',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.ToolboxExplorerSummary && window.ToolboxFloorSurvey);

/**
 * A job shaped like a real one: two levels, one with a flooring transition
 * so the corrected column has something to do, a scale on one level only, and
 * a Distress Survey with pins, Quick Capture and a general photograph.
 */
const FIXTURE = {
  plans: {
    updatedAt: '2026-09-29T18:00:00.000Z',
    canvases: [
      { id: 'cv-main', name: 'Main Level', plan: { id: 'plan-main' }, contourLayer: { id: 'contour-main' } },
      { id: 'cv-base', name: 'Basement', plan: { id: 'plan-base' } },
      { id: 'cv-garage', name: 'Garage' },
    ],
  },
  floor: {
    updatedAt: '2026-09-29T18:30:00.000Z',
    inspectionDate: '2026-09-29',
    byCanvasId: {
      'cv-main': {
        canvasId: 'cv-main',
        inspectionDate: '2026-09-29',
        scale: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, lengthInches: 120 },
        transitions: [{
          id: 't1', surfaceA: 'Tile', surfaceB: 'Carpet/subfloor',
          readingA: 7.2, readingB: 6.8,
        }],
        points: [
          { id: 'p1', index: 1, x: 10, y: 10, value: 9.0, isBasePoint: true, label: 'BP1' },
          { id: 'p2', index: 2, x: 60, y: 10, value: 8.1 },
          { id: 'p3', index: 3, x: 110, y: 10, value: 7.2, transitionId: 't1', isTransitionAnchor: true },
          { id: 'p4', index: 4, x: 160, y: 10, value: 6.5, transitionId: 't1', notes: 'under the window' },
        ],
        areas: [{ id: 'a1', name: 'Main Level' }],
      },
      'cv-base': {
        canvasId: 'cv-base',
        inspectionDate: '2026-09-30',
        points: [
          { id: 'b1', index: 1, x: 5, y: 5, value: 9.0, isBasePoint: true, label: 'BP1' },
          { id: 'b2', index: 2, x: 55, y: 5, value: 8.6 },
        ],
      },
    },
  },
  distress: {
    updatedAt: '2026-10-01T12:00:00.000Z',
    inspectionDate: '2026-10-01',
    pins: [
      { id: 'pin-2', num: 2, canvasId: 'cv-main', location: 'Dining room',
        description: 'Hairline crack at the sill.', photos: ['ph_a', 'ph_b'] },
      { id: 'pin-1', num: 1, canvasId: 'cv-main', location: 'Front entry',
        description: 'Separation, 1/4 in.', photos: ['ph_c'] },
      { id: 'pin-3', num: 3, canvasId: 'cv-base', location: 'Utility',
        description: 'Step crack, mortar line.', photos: [] },
    ],
    quickCapture: [{ id: 'ph_q1', folder: 'Exterior', ts: 1759300000000 }],
    generalPhotos: [{ id: 'ph_g1' }],
  },
  customer: {
    firstName: 'Rhonda',
    lastName: 'Sorenson',
    propertyAddress: '4925 Edwards Dr NE\nAlbuquerque, NM 87111',
    cellPhone: '505-555-0144',
    email: 'rhonda@example.com',
    customerUpdatedAt: '2026-10-01T12:00:00.000Z',
  },
  report: {
    updatedAt: '2026-10-19T20:45:00.000Z',
    pages: [
      { id: 'p1', type: 'cover' }, { id: 'p2', type: 'discussion' },
      { id: 'p3', type: 'floor' }, { id: 'p4', type: 'pictures' },
    ],
  },
};

const out = await page.evaluate((fx) => {
  const S = window.ToolboxExplorerSummary;
  const ctx = { plans: fx.plans, floor: fx.floor, distress: fx.distress };
  return {
    floor: S.componentSummary('floor', fx.floor, ctx),
    distress: S.componentSummary('distress', fx.distress, ctx),
    plans: S.componentSummary('plans', fx.plans, ctx),
    customer: S.componentSummary('customer', fx.customer, ctx),
    report: S.componentSummary('report', fx.report, ctx),
    figures: S.jobFigures(fx),
    surveyDate: S.surveyDateOf(fx),
    readings: S.readingsCsv(fx.floor, fx.plans),
    pins: S.pinsCsv(fx.distress, fx.plans, fx.floor, function (id) {
      // What the copy recorded: where each photograph actually landed.
      // ph_c collided and took a suffix; ph_b never made it in.
      const landed = {
        ph_a: 'Photographs/Distress Survey/pin-02-dining-room-hairline-crack.jpg',
        ph_c: 'Photographs/Distress Survey/pin-01-front-entry-separation-2.jpg',
      };
      return landed[id] || '';
    }),
    pinsUnmapped: S.pinsCsv(fx.distress, fx.plans, fx.floor),
    mediaMap: S.mediaMapCsv([
      { id: 'ph_c', path: 'Photographs/Distress Survey/pin-01-front-entry-separation-2.jpg',
        label: 'Distress Survey photograph' },
      { id: 'ph_a', path: 'Photographs/Distress Survey/pin-02-dining-room-hairline-crack.jpg',
        label: 'Distress Survey photograph' },
      { id: 'ph_b', path: '', label: 'Distress Survey photograph' },
    ]),
    details: S.customerDetailsText(fx.customer, { displayName: 'Rhonda Sorenson' }),
    folderName: S.archiveFolderName({
      name: 'Rhonda Sorenson',
      address: '4925 Edwards Dr NE\nAlbuquerque, NM 87111',
      components: fx,
    }),
    cover: S.coverSheet({
      name: 'Rhonda Sorenson',
      address: '4925 Edwards Dr NE',
      components: fx,
      folders: [{ name: 'Photographs', what: '4 pictures' }],
      missing: ['A finished report PDF. No report has been printed for this job.'],
    }),
    emptyFloor: S.componentSummary('floor', { byCanvasId: {} }, { plans: fx.plans }),
    noPins: S.pinsCsv({ pins: [] }, fx.plans, fx.floor),
  };
}, FIXTURE);

// ------------------------------------------------- what it says out loud
check('a Floor Survey says its levels, its readings and when it was surveyed',
  out.floor.headline === '2 levels · Main Level 4, Basement 2 · surveyed Sep 30, 2026',
  out.floor.headline);
check('and carries the biggest fall as a figure, naming the level it is on',
  out.floor.figures.some((f) => f.label === 'Elevation range' && f.value === '2.1 in on Main Level'),
  JSON.stringify(out.floor.figures));
check('a Distress Survey says its photographs, its pins and the levels they are on',
  out.distress.headline === '5 photographs · on 3 pins · across Main Level, Basement · Oct 1, 2026',
  out.distress.headline);
check('plans say how many levels have a picture, and name the one that does not',
  out.plans.headline === '3 levels · Main Level, Basement, Garage' &&
  out.plans.figures.some((f) => f.label === 'Plan images' && f.value === '2 of 3') &&
  out.plans.notes.join(' ').indexOf('Garage') >= 0,
  JSON.stringify({ head: out.plans.headline, notes: out.plans.notes }));
check('the contour layer is counted, not quietly dropped',
  out.plans.figures.some((f) => f.label === 'Contour layers' && f.value === '1'),
  JSON.stringify(out.plans.figures));
check('customer information reads as a person, not a record',
  out.customer.headline === 'Rhonda Sorenson' &&
  out.customer.figures.some((f) => f.label === 'Cell' && f.value === '505-555-0144'),
  out.customer.headline);
check('a report says how many pages, and does not claim to be a finished PDF',
  out.report.headline.indexOf('4 pages') === 0 &&
  out.report.notes.join(' ').indexOf('not a finished PDF') >= 0,
  JSON.stringify({ head: out.report.headline, notes: out.report.notes }));
check('a Floor Survey with nothing in it says so rather than inventing a level',
  out.emptyFloor.headline === 'No readings stored', out.emptyFloor.headline);

// ------------------------------------------- the figures for the job pane
check('the job figures are the ones the drawings carry',
  JSON.stringify(out.figures.map((f) => f.label)) ===
  JSON.stringify(['Survey', 'Levels', 'Readings', 'Pins', 'Photographs', 'Elevation range', 'Report pages']),
  JSON.stringify(out.figures));
check('and they are computed from the survey, not typed',
  out.figures.find((f) => f.label === 'Readings').value === '6' &&
  out.figures.find((f) => f.label === 'Pins').value === '3' &&
  out.figures.find((f) => f.label === 'Photographs').value === '5',
  JSON.stringify(out.figures));
check('the job is dated by the floor survey, the decided rule',
  out.surveyDate === '2026-09-30', out.surveyDate);

// ------------------------------------------------------- the readings CSV
const readingLines = out.readings.trim().split('\r\n');
check('the readings CSV carries the raw reading AND the corrected elevation',
  readingLines[0] === 'Level,Point,Label,X (plan),Y (plan),Reading (in),Correction (in),' +
  'Elevation (in),Base point,Transition,Notes',
  readingLines[0]);
check('a point under a transition shows the correction and the sum',
  readingLines[4] === 'Main Level,4,,160,10,6.5,0.4,6.9,,"Carpet/subfloor correction +0.4""",under the window',
  readingLines[4]);
check('the anchor keeps its own reading, with no correction applied',
  readingLines[3] === 'Main Level,3,,110,10,7.2,0,7.2,,reference side of Tile,',
  readingLines[3]);
check('a point with no transition is unchanged either way',
  readingLines[1] === 'Main Level,1,BP1,10,10,9,0,9,yes,,', readingLines[1]);
check('every reading on every level is a row',
  readingLines.length === 7, String(readingLines.length));
check('the corrected column agrees with Floor Survey’s own implementation',
  await page.evaluate((fx) => {
    const layer = fx.floor.byCanvasId['cv-main'];
    const theirs = window.ToolboxFloorSurvey.withCorrectedValues(
      layer.points, layer.transitions, layer.transitionGroupAverages,
    );
    const csv = window.ToolboxExplorerSummary.readingsCsv(fx.floor, fx.plans);
    return theirs.every((p) => {
      const row = csv.split('\r\n').find((line) => line.indexOf('Main Level,' + p.index + ',') === 0);
      return !!row && row.split(',')[7] === String(Math.round(p.value * 100) / 100);
    });
  }, FIXTURE), 'one implementation');

// ------------------------------------------------------------ the pin list
const pinLines = out.pins.trim().split('\r\n');
check('the pin list is ordered by pin number, not by storage order',
  pinLines[1].indexOf('1,Main Level,Front entry') === 0 &&
  pinLines[2].indexOf('2,Main Level,Dining room') === 0,
  pinLines.slice(1, 3).join(' | '));
/**
 * THE LINK FROM A PIN TO ITS PICTURE, which is what this file is for.
 *
 * The column used to carry the storage id -- ph_a -- while the copy renamed
 * the bytes to a path. So the one file whose job is to say which photograph
 * shows which crack named a file that is not in the folder. It now carries
 * the path the bytes actually took, collision suffix and all, with the id
 * kept in its own column because the records under Technical/ use it.
 */
check('a pin points at the file its photograph is actually in',
  pinLines[2] === '2,Main Level,Dining room,Hairline crack at the sill.,2,' +
  'Photographs/Distress Survey/pin-02-dining-room-hairline-crack.jpg | (not in this copy),' +
  'ph_a ph_b', pinLines[2]);
check('a name collision is followed to the suffixed file, not the plain one',
  pinLines[1].indexOf('pin-01-front-entry-separation-2.jpg') > 0, pinLines[1]);
check('a photograph that is not in the copy says so, rather than leaving a blank',
  pinLines[2].indexOf('(not in this copy)') > 0, pinLines[2]);
check('and the storage id is still there, because the records under Technical use it',
  pinLines[2].split(',').slice(-1)[0] === 'ph_a ph_b', pinLines[2]);
check('a pin with no photograph is still listed',
  pinLines[3] === '3,Basement,Utility,"Step crack, mortar line.",0,,', pinLines[3]);
check('with no mapping at all, every photograph is declared not in the copy',
  out.pinsUnmapped.indexOf('(not in this copy)') > 0 &&
  out.pinsUnmapped.indexOf('ph_a ph_b') > 0, 'honest without a map');

const mapLines = out.mediaMap.trim().split('\r\n');
check('the mapping file turns a storage id into a file in this folder',
  mapLines[0] === 'Stored as,In this copy,What it is' &&
  mapLines[1] === 'ph_a,Photographs/Distress Survey/pin-02-dining-room-hairline-crack.jpg,' +
  'Distress Survey photograph', mapLines.slice(0, 2).join(' | '));
check('and says plainly which ids have no file behind them',
  mapLines[2] === 'ph_b,(not in this copy),Distress Survey photograph', mapLines[2]);
check('a Distress Survey with no pins produces no file at all',
  out.noPins === '', JSON.stringify(out.noPins));

// ------------------------------------------------- customer details + cover
check('customer details read as a page, not a record',
  out.details.indexOf('Rhonda Sorenson') === 0 &&
  out.details.indexOf('4925 Edwards Dr NE') > 0 &&
  out.details.indexOf('Cell    505-555-0144') > 0,
  JSON.stringify(out.details.slice(0, 60)));
check('the copy is named for who it was for, where, and the field work date',
  out.folderName === 'Rhonda Sorenson - 4925 Edwards Dr NE (2026-09-30)', out.folderName);
check('the cover sheet says what the survey records',
  out.cover.indexOf('Readings') > 0 && out.cover.indexOf('Elevation range') > 0, 'figures');
check('and says plainly what is NOT in the folder',
  out.cover.indexOf('What is NOT in this folder') > 0 &&
  out.cover.indexOf('No report has been printed for this job.') > 0, 'honest');
check('and explains the readings file to someone who has never seen Toolbox',
  out.cover.indexOf('Reading (in) is what the instrument showed') > 0 &&
  out.cover.indexOf('once that level\'s scale is set') > 0, 'explained');
/**
 * X and Y are exported straight from the stored point, in the plan image's
 * own coordinates. The cover sheet used to say they were "measured from its
 * base point", which is a subtraction nothing performs -- a false statement
 * about the data, written into a file meant to outlive the application.
 */
check('and does not claim X and Y were measured from anywhere',
  out.cover.indexOf('in the\n  image\'s own coordinates, exactly as Toolbox stored them') > 0 &&
  out.cover.indexOf('They\n  are not measured from anywhere') > 0 &&
  out.cover.indexOf('measured from its base') < 0,
  JSON.stringify(out.cover.slice(out.cover.indexOf('X and Y'),
    out.cover.indexOf('X and Y') + 160)));
check('and says an empty Elevation cell is a failure, not a zero correction',
  out.cover.indexOf('An empty') > 0 &&
  out.cover.indexOf('that it was zero') > 0, 'not a zero');

// ------------- what it does when the correction cannot be reached at all
//
// A page that never loaded the Floor Survey bundle must not print raw
// readings under a heading that calls them corrected.
const degraded = await page.evaluate((fx) => {
  const real = window.ToolboxFloorSurvey;
  window.ToolboxFloorSurvey = undefined;
  try {
    const notes = [];
    const csv = window.ToolboxExplorerSummary.readingsCsv(fx.floor, fx.plans, notes);
    const summary = window.ToolboxExplorerSummary.componentSummary('floor', fx.floor, { plans: fx.plans });
    const fall = summary.figures.filter((f) => f.label.indexOf('Elevation range') === 0)[0];
    return { header: csv.split('\r\n')[0], row: csv.split('\r\n')[4],
      basement: csv.split('\r\n')[6],
      headline: summary.headline, fall: fall && fall.label, notes: notes };
  } finally {
    window.ToolboxFloorSurvey = real;
  }
}, FIXTURE);
check('and the range it reports is labelled uncorrected rather than passed off',
  degraded.fall === 'Elevation range (uncorrected)', String(degraded.fall));
// A level with no transitions needed no helper, so it keeps its elevations
// even with nothing to call. Reporting it as a failure would be a second
// kind of dishonesty: claiming something was lost that never existed.
check('while a level with no transitions keeps its elevations either way',
  degraded.basement === 'Basement,2,,55,5,8.6,0,8.6,,,', degraded.basement);
check('with no correction available, a level that needs one has empty cells and says why',
  degraded.header === 'Level,Point,Label,X (plan),Y (plan),Reading (in),' +
  'Correction (in),Elevation (in),Base point,Transition,Notes' &&
  degraded.notes.length === 1 && /Main Level has flooring transitions/.test(degraded.notes[0]) &&
  degraded.row === 'Main Level,4,,160,10,6.5,,,,Carpet/subfloor,under the window',
  JSON.stringify(degraded));

/**
 * A CORRECTION THAT THREW IS NOT A CORRECTION OF ZERO.
 *
 * The catch used to fall back to the raw points and carry on, so a raw 6.5
 * came out in the Elevation column as 6.5 with a correction of 0 -- which
 * reads as "measured on the reference surface, nothing to correct". A false
 * statement about a measurement, in a file meant to outlive Toolbox.
 */
const threw = await page.evaluate((fx) => {
  const real = window.ToolboxFloorSurvey.withCorrectedValues;
  window.ToolboxFloorSurvey.withCorrectedValues = function () {
    throw new Error('transitions are broken');
  };
  try {
    const notes = [];
    const csv = window.ToolboxExplorerSummary.readingsCsv(fx.floor, fx.plans, notes);
    const lines = csv.trim().split('\r\n');
    return {
      header: lines[0],
      transitioned: lines[4],
      plain: lines[1],
      basement: lines[6],
      notes: notes,
    };
  } finally {
    window.ToolboxFloorSurvey.withCorrectedValues = real;
  }
}, FIXTURE);

check('a thrown correction leaves the Elevation cell empty, not equal to the reading',
  threw.transitioned === 'Main Level,4,,160,10,6.5,,,,"Carpet/subfloor correction +0.4""",under the window', threw.transitioned);
check('and does not report a correction of zero for a point it could not correct',
  threw.plain === 'Main Level,1,BP1,10,10,9,,,yes,,', threw.plain);
check('and says which level could not be corrected',
  threw.notes.length === 1 && /Main Level/.test(threw.notes[0]) &&
  /readings themselves are unaffected/.test(threw.notes[0]),
  JSON.stringify(threw.notes));
check('a level with no transitions is unaffected by another level failing',
  threw.basement === 'Basement,2,,55,5,8.6,0,8.6,,,', threw.basement);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
