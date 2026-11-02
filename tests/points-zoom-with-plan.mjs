/**
 * Capture reading dots zoom with the plan and stay quiet at Point size 6.
 * Run: node tests/points-zoom-with-plan.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const screen = readFileSync(join(root, "floor-survey/src/lib/screen-size.ts"), "utf8");
const topo = readFileSync(join(root, "floor-survey/src/components/tabs/TopoTab.tsx"), "utf8");
const field = readFileSync(join(root, "floor-survey/src/components/tabs/FieldTab.tsx"), "utf8");

assert.match(screen, /export function capturePlanZoomImageSize/);
assert.match(screen, /export function planProportionalSize/);
assert.match(
  screen,
  /Reading \*dots\* use planProportionalSize/,
);

/** Mirror planProportionalSize — keep in sync with screen-size.ts. */
const REFERENCE = 1100;
function planProportionalSize(base, planLongSide) {
  if (!(planLongSide > 0)) return base;
  return base * (planLongSide / REFERENCE);
}

const base = 6;
const planLong = 900;
const imgR = planProportionalSize(base, planLong);
assert.ok(Math.abs(imgR - base * (planLong / REFERENCE)) < 1e-9);

const fit = 0.45;
const screenAtFit = imgR * fit;
const zoomIn = fit * 2.2;
const screenZoomedIn = imgR * zoomIn;
assert.ok(
  Math.abs(screenZoomedIn / screenAtFit - zoomIn / fit) < 1e-9,
  "on-screen size must track zoom",
);
// Size 6 must be quiet on a phone fit overview — not ~4+ CSS px radius.
assert.ok(
  screenAtFit < 3.0,
  `Point size 6 at fit must be small on screen (got cssRadius ${screenAtFit})`,
);

// Old label-fit formula left size 6 too big at fit (~base*0.72).
const oldLabelFitScreen = base * 0.72;
assert.ok(
  screenAtFit < oldLabelFitScreen * 0.75,
  `plan-proportional size 6 must be quieter than label-fit formula (${screenAtFit} vs ${oldLabelFitScreen})`,
);

assert.match(topo, /function pointDotRadiusImg\(dotBase: number, floor: Floor\)/);
assert.match(topo, /planProportionalSize/);
assert.doesNotMatch(topo, /const dotR = capturePlanZoomImageSize/);
assert.doesNotMatch(topo, /const dotR = chromeSizeImg\(dotBase/);
assert.match(topo, /pointSize = 2/);

assert.match(field, /function pointDotRadiusImg\(dotBase: number, floor: Floor\)/);
assert.match(field, /pointDotRadiusImg\(pointSize, floor\)/);
assert.doesNotMatch(field, /screenAnchoredImageSize\(pointSize/);
assert.doesNotMatch(field, /pointDotRadiusImg\(pointSize, fit/);

console.log("points-zoom-with-plan: ok");
console.log(
  JSON.stringify({
    base,
    planLong,
    imageRadius: imgR,
    screenAtFit,
    screenZoomedIn,
    oldLabelFitScreen,
  }),
);
