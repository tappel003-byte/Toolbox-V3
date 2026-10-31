/**
 * Label seats: default sits close (right); presets write labelDx/labelDy.
 *
 * Run: node tests/label-seat.mjs
 */
import assert from 'assert';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Load compiled? Prefer importing source via tsx if available; else duplicate
// the pure math by reading the module through dynamic import of the built path.
// The helper is plain TS with no React — use a tiny inline port matching label-seat.ts
// only if import fails. Prefer node --experimental-strip-types or vite-node.

let labelSeatOffset;
let LABEL_SEATS;
try {
  const mod = await import('../floor-survey/src/lib/label-seat.ts');
  labelSeatOffset = mod.labelSeatOffset;
  LABEL_SEATS = mod.LABEL_SEATS;
} catch {
  // Node without TS loader: evaluate the built idea by reading and Function.
  const fs = await import('fs');
  const src = fs.readFileSync(
    new URL('../floor-survey/src/lib/label-seat.ts', import.meta.url),
    'utf8',
  );
  // Strip types enough for Function — only the switch body matters.
  const bare = src
    .replace(/export type[\s\S]*?;/g, '')
    .replace(/export const LABEL_SEATS[\s\S]*?;\n/, '')
    .replace(/export function/g, 'function')
    .replace(/: LabelSeat/g, '')
    .replace(/: number/g, '')
    .replace(/: \{ dx: number; dy: number \}/g, '')
    .replace(/as const/g, '');
  const fn = new Function(`${bare}; return { labelSeatOffset, LABEL_SEATS: [
    { id: 'left', label: 'Left' },
    { id: 'right', label: 'Right' },
    { id: 'top', label: 'Top' },
    { id: 'middle', label: 'Middle' },
    { id: 'center', label: 'Center' },
  ] };`);
  ({ labelSeatOffset, LABEL_SEATS } = fn());
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

check('five seats', LABEL_SEATS.length === 5, JSON.stringify(LABEL_SEATS.map((s) => s.id)));

const font = 12;
const padX = 4;
const padY = 2.5;
const textW = 20;

const right = labelSeatOffset('right', textW, font, padX, padY);
const left = labelSeatOffset('left', textW, font, padX, padY);
const top = labelSeatOffset('top', textW, font, padX, padY);
const middle = labelSeatOffset('middle', textW, font, padX, padY);
const center = labelSeatOffset('center', textW, font, padX, padY);

check('right is to the right of the point', right.dx > 0, JSON.stringify(right));
check('left is to the left of the point', left.dx < -textW, JSON.stringify(left));
check('top is above the point', top.dy < -font, JSON.stringify(top));
check('middle is below the point', middle.dy > 0, JSON.stringify(middle));
check('center is on the point (text centered)', Math.abs(center.dx + textW / 2) < 0.01, JSON.stringify(center));

// Default right seat should be tighter than the old (+8,+6)*k at k≈2 → (16,12).
check(
  'default right seat is closer than the old (+16,+12) default',
  right.dx < 16 && Math.abs(right.dy) <= font / 2 + 0.01,
  JSON.stringify(right),
);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
