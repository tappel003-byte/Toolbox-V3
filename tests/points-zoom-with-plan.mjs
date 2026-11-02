/**
 * Capture reading dots + labels are plan-proportional and quiet at size 6.
 * Run: node tests/points-zoom-with-plan.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const topo = readFileSync(join(root, "floor-survey/src/components/tabs/TopoTab.tsx"), "utf8");
const field = readFileSync(join(root, "floor-survey/src/components/tabs/FieldTab.tsx"), "utf8");
const panel = readFileSync(join(root, "floor-survey/src/components/DataPointsPanel.tsx"), "utf8");
const capture = readFileSync(join(root, "floor-survey/src/lib/capture-sizes.ts"), "utf8");

const REFERENCE = 1100;
function planProportionalSize(base, planLongSide) {
  if (!(planLongSide > 0)) return base;
  return base * (planLongSide / REFERENCE);
}

const base = 6;
const planLong = 900;
const fit = 0.45;
const imgR = planProportionalSize(base, planLong);
const screenAtFit = imgR * fit;
assert.ok(
  screenAtFit < 3.0,
  `size 6 at fit must be small (got ${screenAtFit})`,
);
assert.ok(screenAtFit < base * 0.72 * 0.75, "quieter than old label-fit screen size");

assert.match(topo, /function pointLabelFontImg\(fontBase: number, floor: Floor\)/);
assert.match(topo, /function pointDotRadiusImg\(dotBase: number, floor: Floor\)/);
assert.match(topo, /const LABEL_SIZE_MIN = 2/);
assert.doesNotMatch(topo, /const LABEL_SIZE_MIN = 6/);
assert.doesNotMatch(topo, /capturePlanZoomImageSize/);
assert.match(topo, /pointLabelFontImg\(fontBase, floor\)/);
assert.match(topo, /pointDotRadiusImg\(dotBase, floor\)/);

assert.match(field, /pointLabelFontImg\(fontBase, floor\)/);
assert.match(field, /pointDotRadiusImg\(pointSize, floor\)/);
assert.doesNotMatch(field, /capturePlanZoomImageSize/);

assert.doesNotMatch(panel, /\{pointSize\}px/);
assert.doesNotMatch(panel, /\{labelFontSize\}px/);
assert.match(panel, /Math\.max\(2, labelFontSize - 1\)/);
assert.match(capture, /Math\.max\(2, Math\.min\(28/);

console.log("points-zoom-with-plan: ok");
console.log(JSON.stringify({ base, planLong, imgR, screenAtFit }));
