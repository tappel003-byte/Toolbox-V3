/**
 * Point size + color live in Control panel Accessories (field) and Report
 * Accessories → Points. Capture uses the same store as Data entry; report
 * uses readingPoint* on settings — never dpp-*.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const topo = readFileSync(join(root, "floor-survey/src/components/tabs/TopoTab.tsx"), "utf8");
const pointStyle = readFileSync(join(root, "floor-survey/src/lib/point-style.ts"), "utf8");
const types = readFileSync(join(root, "floor-survey/src/lib/types.ts"), "utf8");
const host = readFileSync(join(root, "floor-survey/src/host/HostWorkspace.tsx"), "utf8");
const reportHost = readFileSync(
  join(root, "floor-survey/src/host/ReportTopoWorkspace.tsx"),
  "utf8",
);
const figure = readFileSync(join(root, "floor-survey/src/lib/report-topo-figure.ts"), "utf8");
const dataPanel = readFileSync(
  join(root, "floor-survey/src/components/DataPointsPanel.tsx"),
  "utf8",
);

assert.match(topo, /function PointMarkStyleControls/);
assert.match(topo, /label="Point size"/);
assert.match(topo, /aria-label="Point color"/);
assert.match(topo, /data-point-mark-style/);
// Point size matches H/L/Δ: unitless −/+, no "2px" face.
assert.match(
  topo,
  /label="Point size"[\s\S]*?unitless[\s\S]*?onChange=\{onPointSizeChange\}/,
);
assert.match(topo, /h-5 w-5 rounded-full/);
// Control panel sits above the floating H/L/Δ chip.
assert.match(topo, /absolute z-\[60\]/);

// Field Readings → Accessories includes the mark controls.
assert.match(topo, /id: "accessories"[\s\S]*PointMarkStyleControls[\s\S]*H\/L\/Δ size/);
// Accessories size rows stack with air — not a wrapping side-by-side that
// collapses into a jammed column under the help line on a phone panel.
assert.match(
  topo,
  /id: "accessories"[\s\S]*space-y-5[\s\S]*space-y-5 border-t[\s\S]*label="H\/L\/Δ size"[\s\S]*label="High\/Low size"/,
);
assert.doesNotMatch(
  topo,
  /Press and move to place[\s\S]{0,80}flex flex-wrap items-end gap-x-4 gap-y-2/,
);

// Report Accessories has a Points sibling tab.
assert.match(topo, /\["points", "Points"\]/);
assert.match(topo, /reportAccessoryTab === "points"/);

assert.match(types, /readingPointSize: number/);
assert.match(types, /readingPointColor: string/);
assert.match(types, /readingPointSize: 2/);
assert.match(types, /readingPointColor: "#dc2626"/);

assert.match(pointStyle, /POINT_COLOR_PRESETS/);
assert.match(pointStyle, /export function clampPointSize/);
assert.match(pointStyle, /Report Builder Accessories is the door into those/);
assert.match(pointStyle, /report-owned values/);

// Capture host wires the same setters Data entry uses.
assert.match(host, /onPointSizeChange=\{setPointSize\}/);
assert.match(host, /onPointColorChange=\{setPointColor\}/);

// Report must not pass capture callbacks — settings path only.
assert.doesNotMatch(reportHost, /onPointSizeChange=/);
assert.doesNotMatch(reportHost, /onPointColorChange=/);
assert.match(reportHost, /reportPointStyle\(settings\)/);
assert.match(reportHost, /never capture dpp-size/);

assert.match(figure, /reportPointStyle\(settings\)/);
assert.doesNotMatch(figure, /readCapturePointStyle/);

assert.match(dataPanel, /POINT_COLOR_PRESETS/);
assert.match(dataPanel, /POINT_SIZE_MIN/);
assert.match(dataPanel, /POINT_SIZE_MAX/);

console.log("point-mark-accessories: ok");
