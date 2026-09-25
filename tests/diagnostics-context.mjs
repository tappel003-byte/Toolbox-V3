/**
 * Diagnostics reading context: inches are the Floor Survey contract,
 * and a base point is a reference only when one is stored.
 * Run: node tests/diagnostics-context.mjs
 */
import { readFileSync } from 'fs';
import vm from 'vm';

const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL('../js/diagnostics.js', import.meta.url), 'utf8'), sandbox);
const api = sandbox.window.ToolboxDiagnostics;

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' — ' + detail : ''));
}

const boundary = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];
const exclusion = {
  polygon: [
    { x: 70, y: 70 },
    { x: 95, y: 70 },
    { x: 95, y: 95 },
    { x: 70, y: 95 },
  ],
};

const correctedPoints = [
  { id: 'bp', x: 20, y: 20, value: 8.75, rawValue: 8.75, isBasePoint: true, label: 'BP1' },
  { id: 'down', x: 40, y: 40, value: 8.35, rawValue: 7.8 },
  { id: 'hi', x: 50, y: 30, value: 9.4, rawValue: 9.4 },
  { id: 'ex', x: 80, y: 80, value: 12, rawValue: 12 },
  { id: 'out', x: 150, y: 150, value: 1, rawValue: 1 },
];
const before = JSON.stringify(correctedPoints);
const known = api.summarizeReadings({
  levelName: 'Basement',
  surveyDate: '2026-04-18',
  boundary,
  exclusions: [exclusion],
  points: correctedPoints,
});
check('summarize does not mutate Floor Survey points', JSON.stringify(correctedPoints) === before);
check(
  'stored base point is the reference, in inches',
  known.unit === 'in' &&
    known.reference &&
    known.reference.length === 1 &&
    known.reference[0].label === 'BP1' &&
    known.reference[0].value === 8.75 &&
    known.referenceMessage === 'Base point BP1 8.75 in',
  known.referenceMessage,
);
check(
  'high, low, and range use corrected readings and skip exclusions',
  known.high === 9.4 &&
    known.low === 8.35 &&
    known.range === 1.05 &&
    known.usablePointCount === 3 &&
    known.excludedPointCount === 1 &&
    known.outsideBoundaryCount === 1 &&
    known.correctedPointCount === 1 &&
    known.readingsMessage === 'High and low include flooring corrections.' &&
    known.surface === 'ready',
  JSON.stringify({ high: known.high, low: known.low, range: known.range, usable: known.usablePointCount }),
);
check('survey date and level are passed through', known.levelName === 'Basement' && known.surveyDate === '2026-04-18');

const noDatumPoints = [
  { id: 'a', x: 10, y: 10, value: 0.1, rawValue: 0.1 },
  { id: 'b', x: 20, y: 20, value: 0.4, rawValue: 0.4 },
  { id: 'c', x: 30, y: 30, value: 1.2, rawValue: 1.2 },
];
const noDatum = api.summarizeReadings({
  levelName: 'First Floor',
  surveyDate: '',
  boundary,
  exclusions: [],
  points: noDatumPoints,
});
check(
  'missing base point does not invent a 9.0 datum',
  noDatum.reference === null &&
    noDatum.referenceMessage === 'No base-point reference recorded.' &&
    noDatum.unit === 'in' &&
    noDatum.high === 1.2 &&
    noDatum.low === 0.1 &&
    noDatum.range === 1.1 &&
    noDatum.surveyDate === null &&
    !noDatum.referenceMessage.includes('9.0') &&
    noDatum.readingsMessage === 'High and low are measured readings.',
  noDatum.referenceMessage,
);

const noReadings = api.summarizeReadings({
  levelName: 'Attic',
  surveyDate: '',
  boundary,
  points: [
    { id: 'blank', x: 10, y: 10, value: null },
    { id: 'nan', x: 12, y: 12, value: Number.NaN },
  ],
});
const noReadingLines = api.contextLines(noReadings, 3).join('\n');
check(
  'no finite reading does not claim a unit',
  noReadings.unit === null &&
    noReadings.high === null &&
    noReadings.low === null &&
    noReadings.range === null &&
    noReadings.surface === 'too-few-points' &&
    !/\d in\b/.test(noReadingLines) &&
    !/\binches\b/i.test(noReadingLines) &&
    !noReadingLines.includes('9.0'),
  noReadingLines,
);

const missingBoundary = api.summarizeReadings({
  levelName: 'Garage',
  boundary: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  points: [
    { id: 'a', x: 1, y: 1, value: 2, rawValue: 2 },
    { id: 'b', x: 2, y: 2, value: 3, rawValue: 3 },
    { id: 'c', x: 3, y: 3, value: 4, rawValue: 4 },
  ],
});
check(
  'missing boundary prevents a surface',
  missingBoundary.surface === 'missing-boundary' &&
    missingBoundary.surfaceMessage === 'Boundary is missing. No surface.' &&
    missingBoundary.usablePointCount === 3 &&
    missingBoundary.unit === 'in',
  missingBoundary.surfaceMessage,
);

const tooFew = api.summarizeReadings({
  levelName: 'Second Floor',
  boundary,
  points: [{ id: 'only', x: 10, y: 10, value: 2, rawValue: 2 }],
});
check(
  'too few points prevent a surface',
  tooFew.surface === 'too-few-points' &&
    tooFew.surfaceMessage === 'Too few survey points for a surface.' &&
    tooFew.usablePointCount === 1,
  tooFew.surfaceMessage,
);

const bothMissing = api.summarizeReadings({
  levelName: 'Porch',
  boundary: [],
  points: [{ id: 'only', x: 1, y: 1, value: 2, rawValue: 2 }],
});
check(
  'missing boundary and too few points are both stated',
  bothMissing.surfaceMessage === 'Boundary is missing. Too few survey points for a surface.',
  bothMissing.surfaceMessage,
);

const lines = api.contextLines(known, 3);
const joined = lines.join('\n');
check(
  'lines keep the level, date, exaggeration, legend range, and not-to-scale notice',
  joined.includes('Basement') &&
    joined.includes('Survey date 2026-04-18') &&
    joined.includes('High 9.40 in · Low 8.35 in · Range 1.05 in') &&
    joined.includes('Vertical exaggeration 3.0×') &&
    joined.includes('Not to scale — for illustration purposes only') &&
    joined.includes('Mean 8.83 in') &&
    joined.includes('Median 8.75 in') &&
    joined.includes('Mode not distinct') &&
    joined.includes('Standard deviation 0.43 in') &&
    joined.includes('Distribution · low third 1 · middle 1 · high third 1') &&
    joined.includes('Measured readings are evidence. This view does not infer heave, settlement, cause, or repair.'),
  joined,
);
check(
  'wording does not turn the readings into a diagnosis',
  !/heave is|settlement is|caused by|recommend/i.test(joined),
  joined,
);

const captured = api.captureContext(known, {
  canvasId: 'canvas-base',
  exaggeration: 4.24,
  palette: 'brown',
  reversePalette: false,
  legendColors: ['rgb(130, 90, 55)', 'rgb(116, 146, 118)'],
});
check(
  'capture context keeps the same level, range, exaggeration, and legend',
  captured.canvasId === 'canvas-base' &&
    captured.levelName === 'Basement' &&
    captured.high === 9.4 &&
    captured.low === 8.35 &&
    captured.legendLow === 8.35 &&
    captured.legendHigh === 9.4 &&
    captured.exaggeration === 4.2 &&
    captured.palette === 'brown' &&
    captured.legendColors.length === 2 &&
    captured.lines.includes('Vertical exaggeration 4.2×'),
  JSON.stringify({ exaggeration: captured.exaggeration, legend: [captured.legendLow, captured.legendHigh] }),
);

const noSurface = api.captureContext(tooFew, { canvasId: 'canvas-2', exaggeration: 3, palette: 'brown' });
check(
  'a missing surface does not invent a color-scale range',
  noSurface.legendLow === null && noSurface.legendHigh === null && noSurface.surface === 'too-few-points',
);

const storedDatum = api.summarizeReadings({
  levelName: 'Slab',
  boundary,
  points: [
    { id: 'bp', x: 10, y: 10, value: 9, rawValue: 9, isBasePoint: true, label: 'BP1' },
    { id: 'b', x: 20, y: 20, value: 9.2, rawValue: 9.2 },
    { id: 'c', x: 30, y: 30, value: 9.4, rawValue: 9.4 },
  ],
});
check(
  'a stored 9.00 in base point is reported because it is stored',
  storedDatum.referenceMessage === 'Base point BP1 9.00 in',
  storedDatum.referenceMessage,
);

const repeated = api.summarizeReadings({
  levelName: 'Slab',
  boundary,
  points: [
    { id: 'a', x: 10, y: 10, value: 9.1, rawValue: 9.1 },
    { id: 'b', x: 20, y: 20, value: 9.1, rawValue: 9.1 },
    { id: 'c', x: 30, y: 30, value: 8.4, rawValue: 8.4 },
  ],
});
check(
  'mode is named only when one reading is strictly more common',
  repeated.modeDistinct === true &&
    repeated.mode === 9.1 &&
    api.contextLines(repeated, 1).join('\n').includes('Mode 9.10 in'),
  JSON.stringify({ mode: repeated.mode, distinct: repeated.modeDistinct }),
);
check(
  'statistics stay null when there is no finite reading',
  noReadings.mean === null &&
    noReadings.median === null &&
    noReadings.standardDeviation === null &&
    noReadings.distribution === null,
);

const failed = results.filter((item) => !item.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
if (failed.length) process.exitCode = 1;
