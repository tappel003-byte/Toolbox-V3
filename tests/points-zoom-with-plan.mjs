/**
 * Capture reading dots zoom with the plan — same rule as reading labels.
 * Run: node tests/points-zoom-with-plan.mjs
 *
 * Tim (Nov 1, 2026): points were supposed to scale with the zoom, just like
 * readings. Measure the formula and the call sites so a zoomed-out Topo cannot
 * keep screen-anchored dots while labels track the plan.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const screen = readFileSync(join(root, "floor-survey/src/lib/screen-size.ts"), "utf8");
const topo = readFileSync(join(root, "floor-survey/src/components/tabs/TopoTab.tsx"), "utf8");
const field = readFileSync(join(root, "floor-survey/src/components/tabs/FieldTab.tsx"), "utf8");

assert.match(screen, /export const CAPTURE_PLAN_ZOOM_FIT_FACTOR = 0\.72/);
assert.match(screen, /export function capturePlanZoomImageSize/);

/** Mirror of capturePlanZoomImageSize — keep in sync with screen-size.ts. */
function capturePlanZoomImageSize(base, fitScale) {
  const fit = fitScale > 0 ? fitScale : 1;
  return (Math.max(1, base) * 0.72) / fit;
}

function screenAnchoredImageSize(base, viewScale) {
  const z = viewScale > 0 ? viewScale : 1;
  const factor = z >= 1 ? Math.pow(z, 0.35) : 1;
  const onScreen = Math.min(base * 2.5, Math.max(base, base * factor));
  return onScreen / z;
}

const base = 4;
const fit = 0.45;
const imgAtFit = capturePlanZoomImageSize(base, fit);
const imgAtSameFitZoomed = capturePlanZoomImageSize(base, fit);
// Image-space radius does not depend on the live view zoom — only on fit —
// so on-screen size tracks the plan when the investigator pinches.
assert.equal(imgAtFit, imgAtSameFitZoomed);
assert.ok(Math.abs(imgAtFit - (base * 0.72) / fit) < 1e-9);

// At fit, on-screen CSS px ≈ image × fit.
const screenAtFit = imgAtFit * fit;
const zoomIn = fit * 2.2;
const screenZoomedIn = imgAtFit * zoomIn;
assert.ok(
  Math.abs(screenZoomedIn / screenAtFit - zoomIn / fit) < 1e-9,
  `screen size must track zoom ratio; got ${screenZoomedIn / screenAtFit} vs ${zoomIn / fit}`,
);
assert.ok(
  screenZoomedIn > screenAtFit * 1.5,
  `pinch-in must grow the dot on screen (${screenAtFit} → ${screenZoomedIn})`,
);

// Old screen-anchored path held roughly constant CSS px when zooming out —
// that is the bug Tim photographed.
const oldImgAtFit = screenAnchoredImageSize(base, fit);
const oldScreenAtFit = oldImgAtFit * fit;
const oldImgZoomedOut = screenAnchoredImageSize(base, fit * 0.5);
const oldScreenZoomedOut = oldImgZoomedOut * (fit * 0.5);
assert.ok(
  Math.abs(oldScreenZoomedOut - oldScreenAtFit) < 0.05 * base,
  "sanity: old path holds screen size when zoom changes",
);
const newScreenZoomedOut = imgAtFit * (fit * 0.5);
assert.ok(
  newScreenZoomedOut < screenAtFit * 0.6,
  `new path must shrink on zoom-out (${screenAtFit} → ${newScreenZoomedOut})`,
);

assert.match(topo, /function pointDotRadiusImg/);
assert.match(
  topo,
  /const dotR = pointDotRadiusImg\(dotBase, floor, \{[\s\S]*fitScale/,
);
assert.doesNotMatch(
  topo,
  /const dotR = chromeSizeImg\(dotBase/,
);
assert.match(topo, /capturePlanZoomImageSize/);

assert.match(field, /function pointDotRadiusImg/);
assert.match(field, /pointDotRadiusImg\(pointSize, fit\)/);
assert.match(field, /pointDotRadiusImg\(pointSize, fitScaleRef/);
assert.doesNotMatch(field, /screenAnchoredImageSize\(pointSize/);
assert.match(field, /capturePlanZoomImageSize/);

console.log("points-zoom-with-plan: ok");
console.log(
  JSON.stringify({
    base,
    fit,
    imageRadius: imgAtFit,
    screenAtFit,
    screenZoomedIn,
    screenZoomedOut: newScreenZoomedOut,
    zoomRatioIn: screenZoomedIn / screenAtFit,
    zoomRatioOut: newScreenZoomedOut / screenAtFit,
  }),
);
