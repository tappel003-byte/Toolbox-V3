/**
 * Screen-anchored label/dot sizing for Floor Survey Data + Topo.
 * Run: node tests/screen-size.mjs
 */
import fs from 'node:fs';

// Mirror floor-survey/src/lib/screen-size.ts (no TS build required).
function screenAnchoredSize(base, viewScale, opts = {}) {
  const z = viewScale > 0 ? viewScale : 1;
  const minFactor = opts.minFactor ?? 1;
  const maxFactor = opts.maxFactor ?? 2.5;
  const zoomPower = opts.zoomPower ?? 0.35;
  const factor = z >= 1 ? Math.pow(z, zoomPower) : 1;
  return Math.min(base * maxFactor, Math.max(base * minFactor, base * factor));
}

function screenAnchoredImageSize(base, viewScale, opts) {
  const z = viewScale > 0 ? viewScale : 1;
  return screenAnchoredSize(base, z, opts) / z;
}

function oldFormulaOnScreen(base, viewScale) {
  const z = viewScale || 1;
  return Math.min(base * 4, Math.max(base * 0.5, base * Math.pow(z, 0.5)));
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const base = 11;
check('At 1x zoom, chosen size stays on screen', Math.abs(screenAnchoredSize(base, 1) - 11) < 0.01, String(screenAnchoredSize(base, 1)));
check(
  'Desktop fit-scale (0.3) keeps ~11px on screen, not ~6px',
  Math.abs(screenAnchoredSize(base, 0.3) - 11) < 0.01 && oldFormulaOnScreen(base, 0.3) < 7,
  JSON.stringify({ next: screenAnchoredSize(base, 0.3), old: oldFormulaOnScreen(base, 0.3) }),
);
check(
  'Phone-like fit-scale (0.85) stays readable',
  screenAnchoredSize(base, 0.85) >= 10.5,
  String(screenAnchoredSize(base, 0.85)),
);
check(
  'Zoomed-in grows gently, not 4× immediately',
  screenAnchoredSize(base, 4) > 11 && screenAnchoredSize(base, 4) <= 11 * 2.5,
  String(screenAnchoredSize(base, 4)),
);
check(
  'Image-space size grows when fit-scaled out so screen px holds',
  screenAnchoredImageSize(base, 0.3) > screenAnchoredImageSize(base, 1),
  JSON.stringify({
    fit: screenAnchoredImageSize(base, 0.3),
    one: screenAnchoredImageSize(base, 1),
  }),
);

const src = fs.readFileSync('floor-survey/src/lib/screen-size.ts', 'utf8');
const topo = fs.readFileSync('floor-survey/src/components/tabs/TopoTab.tsx', 'utf8');
const field = fs.readFileSync('floor-survey/src/components/tabs/FieldTab.tsx', 'utf8');
check('Helper lives in floor-survey/src/lib/screen-size.ts', /export function screenAnchoredSize/.test(src));
check('Topo uses screenAnchoredImageSize for labels', /screenAnchoredImageSize/.test(topo));
check('Data/Field uses screenAnchoredImageSize for labels', /screenAnchoredImageSize/.test(field));
check(
  'Single-boundary Topo does not draw a second canvas stats pill',
  /Multi-area only: one named canvas pill/.test(topo) &&
    /if \(areaTopos\.length > 1\) \{\s*\n\s*const livePill/.test(topo),
);

const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `FAILED ${failed.length} of ${results.length}` : `ALL PASSED ${results.length}`);
process.exit(failed.length ? 1 : 0);
