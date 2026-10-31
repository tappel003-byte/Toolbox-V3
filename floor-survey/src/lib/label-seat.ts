/**
 * Reading-label seats relative to a point.
 *
 * Free drag still writes labelDx / labelDy. A seat is a preset that parks the
 * number; the gap −/+ walks distance off the dot; drag remains an override
 * for a single label afterward.
 *
 * Two axes (Tim's sketch):
 *
 *          L · R
 *            Top
 *            Middle   ← level with the dot
 *            Bottom
 *
 * Side (Left / Right) + height (Top / Middle / Bottom). Both stay highlighted.
 * Center sits on the dot and has no side.
 *
 * Default has always been Right + Bottom.
 *
 * Offsets are for the text's top-left corner (same convention Topo draws with).
 */

export type LabelSide = "left" | "right";
export type LabelHeight = "top" | "middle" | "bottom";

export type LabelSeatSelection =
  | { mode: "center" }
  | { mode: "side"; side: LabelSide; height: LabelHeight };

/** Historical / product default: number on the right, parked low. */
export const DEFAULT_LABEL_SEAT: LabelSeatSelection = {
  mode: "side",
  side: "right",
  height: "bottom",
};

export const LABEL_SIDES: { id: LabelSide; label: string }[] = [
  { id: "left", label: "Left" },
  { id: "right", label: "Right" },
];

export const LABEL_HEIGHTS: { id: LabelHeight; label: string }[] = [
  { id: "top", label: "Top" },
  { id: "middle", label: "Middle" },
  { id: "bottom", label: "Bottom" },
];

/** Gap −/+ range (unitless steps). Default lands near the tight park. */
export const LABEL_GAP_MIN = 0;
export const LABEL_GAP_MAX = 12;
export const LABEL_GAP_DEFAULT = 2;
/** Each step as a fraction of font size. */
const GAP_STEP_RATIO = 0.12;

/**
 * Clearance between the dot and the label pill for a gap-step setting.
 */
export function labelGapPx(fontPx: number, gapSteps: number = LABEL_GAP_DEFAULT): number {
  const steps = Math.max(LABEL_GAP_MIN, Math.min(LABEL_GAP_MAX, Math.round(gapSteps)));
  return Math.max(1, fontPx * GAP_STEP_RATIO * Math.max(1, steps));
}

/** Vertical text-top offset for a height on a side. */
function heightDy(
  height: LabelHeight,
  fontPx: number,
  padY: number,
  gap: number,
): number {
  const fh = Math.max(1, fontPx);
  switch (height) {
    case "top":
      return -gap - padY - fh;
    case "middle":
      return -fh / 2;
    case "bottom":
      return gap;
  }
}

/**
 * Image-space offset (text top-left from the point) for a seat selection.
 *
 * `gapSteps` is the Show-panel −/+ (distance off the dot). Center ignores it.
 */
export function labelSeatOffset(
  seat: LabelSeatSelection,
  textW: number,
  fontPx: number,
  padX: number,
  padY: number,
  gapSteps: number = LABEL_GAP_DEFAULT,
): { dx: number; dy: number } {
  const tw = Math.max(0, textW);
  const fh = Math.max(1, fontPx);

  if (seat.mode === "center") {
    return { dx: -tw / 2, dy: -fh / 2 };
  }

  const gap = labelGapPx(fontPx, gapSteps);
  const dy = heightDy(seat.height, fontPx, padY, gap);
  if (seat.side === "right") {
    return { dx: gap + padX, dy };
  }
  return { dx: -gap - padX - tw, dy };
}
