/**
 * High/Low hit-testing must cover every drawn surface — not solo-only —
 * so Combined / multi-boundary and Report Builder can press-and-move them.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const topo = readFileSync(join(root, "floor-survey/src/components/tabs/TopoTab.tsx"), "utf8");

assert.doesNotMatch(
  topo,
  /resolved\.showHighLow && hiLo && gridAndContours/,
  "High/Low hit must not require solo hiLo/gridAndContours",
);
assert.match(topo, /for \(let i = areaTopos\.length - 1; i >= 0; i--\)/);
assert.match(
  topo,
  /hitsPin\("pin-high", at\.hi/,
);
assert.match(
  topo,
  /hitsPin\("pin-low", at\.lo/,
);
assert.match(topo, /press-and-move these like other presentation/);

console.log("highlow-hit-all-areas: ok");
