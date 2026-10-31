/**
 * Label seats: Right+Bottom default; side×height + Center.
 *
 * Run: node tests/label-seat.mjs
 */
let labelSeatOffset;
let DEFAULT_LABEL_SEAT;
let LABEL_SIDES;
let LABEL_HEIGHTS;
try {
  const mod = await import('../floor-survey/src/lib/label-seat.ts');
  labelSeatOffset = mod.labelSeatOffset;
  DEFAULT_LABEL_SEAT = mod.DEFAULT_LABEL_SEAT;
  LABEL_SIDES = mod.LABEL_SIDES;
  LABEL_HEIGHTS = mod.LABEL_HEIGHTS;
} catch {
  const fs = await import('fs');
  const src = fs.readFileSync(
    new URL('../floor-survey/src/lib/label-seat.ts', import.meta.url),
    'utf8',
  );
  const bare = src
    .replace(/export type[\s\S]*?;\n/g, '')
    .replace(/export const LABEL_SIDES[\s\S]*?;\n/g, '')
    .replace(/export const LABEL_HEIGHTS[\s\S]*?;\n/g, '')
    .replace(/export const DEFAULT_LABEL_SEAT[\s\S]*?;\n/g, '')
    .replace(/export function/g, 'function')
    .replace(/: LabelSeatSelection/g, '')
    .replace(/: LabelHeight/g, '')
    .replace(/: LabelSide/g, '')
    .replace(/: number/g, '')
    .replace(/: \{ dx: number; dy: number \}/g, '')
    .replace(/as const/g, '');
  const fn = new Function(`${bare}; return {
    labelSeatOffset,
    DEFAULT_LABEL_SEAT: { mode: 'side', side: 'right', height: 'bottom' },
    LABEL_SIDES: [{ id: 'left', label: 'Left' }, { id: 'right', label: 'Right' }],
    LABEL_HEIGHTS: [
      { id: 'top', label: 'Top' },
      { id: 'middle', label: 'Middle' },
      { id: 'bottom', label: 'Bottom' },
    ],
  };`);
  ({ labelSeatOffset, DEFAULT_LABEL_SEAT, LABEL_SIDES, LABEL_HEIGHTS } = fn());
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

check('two sides', LABEL_SIDES.length === 2, JSON.stringify(LABEL_SIDES.map((s) => s.id)));
check('three heights', LABEL_HEIGHTS.length === 3, JSON.stringify(LABEL_HEIGHTS.map((h) => h.id)));
check(
  'default is Right+Bottom',
  DEFAULT_LABEL_SEAT.mode === 'side' &&
    DEFAULT_LABEL_SEAT.side === 'right' &&
    DEFAULT_LABEL_SEAT.height === 'bottom',
  JSON.stringify(DEFAULT_LABEL_SEAT),
);

const font = 12;
const padX = 4;
const padY = 2.5;
const textW = 20;

const rightBottom = labelSeatOffset(
  { mode: 'side', side: 'right', height: 'bottom' },
  textW, font, padX, padY,
);
const rightMiddle = labelSeatOffset(
  { mode: 'side', side: 'right', height: 'middle' },
  textW, font, padX, padY,
);
const rightTop = labelSeatOffset(
  { mode: 'side', side: 'right', height: 'top' },
  textW, font, padX, padY,
);
const leftBottom = labelSeatOffset(
  { mode: 'side', side: 'left', height: 'bottom' },
  textW, font, padX, padY,
);
const center = labelSeatOffset({ mode: 'center' }, textW, font, padX, padY);

check('Right+Bottom is to the right', rightBottom.dx > 0, JSON.stringify(rightBottom));
check('Right+Bottom sits low (dy > middle)', rightBottom.dy > rightMiddle.dy, JSON.stringify({ rightBottom, rightMiddle }));
check('Right+Top sits above middle', rightTop.dy < rightMiddle.dy, JSON.stringify({ rightTop, rightMiddle }));
check('Left+Bottom is to the left', leftBottom.dx < -textW, JSON.stringify(leftBottom));
check('Left and Right share bottom height', Math.abs(leftBottom.dy - rightBottom.dy) < 0.01, JSON.stringify({ leftBottom, rightBottom }));
check('Center is on the point', Math.abs(center.dx + textW / 2) < 0.01 && Math.abs(center.dy + font / 2) < 0.01, JSON.stringify(center));
check(
  'default offset matches Right+Bottom',
  labelSeatOffset(DEFAULT_LABEL_SEAT, textW, font, padX, padY).dx === rightBottom.dx &&
    labelSeatOffset(DEFAULT_LABEL_SEAT, textW, font, padX, padY).dy === rightBottom.dy,
);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
