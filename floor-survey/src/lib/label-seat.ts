/**
 * Reading-label seats relative to a point.
 *
 * Free drag still writes labelDx / labelDy. A seat is a preset that parks the
 * number; drag remains an override afterward.
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

/** Gap between the dot and the label pill, as a fraction of font size. */
const GAP_RATIO = 0.22;

function gapPx(fontPx: number) {
  return Math.max(2, fontPx * GAP_RATIO);
}

/** Vertical text-top offset for a height on a side. */
function heightDy(height: LabelHeight, fontPx: number, padY: number): number {
  const gap = gapPx(fontPx);
  const fh = Math.max(1, fontPx);
  switch (height) {
    case "top":
      // Above the crosshair, still on the chosen side.
      return -gap - padY - fh;
    case "middle":
      // Level with the dot.
      return -fh / 2;
    case "bottom":
      // Below the crosshair (the long-standing default height).
      return gap;
  }
}

/**
 * Image-space offset (text top-left from the point) for a seat selection.
 *
 * `textW` / `fontPx` / pads match the drawn label box so the seat lands
 * where the eye expects.
 */
export function labelSeatOffset(
  seat: LabelSeatSelection,
  textW: number,
  fontPx: number,
  padX: number,
  padY: number,
): { dx: number; dy: number } {
  const gap = gapPx(fontPx);
  const tw = Math.max(0, textW);
  const fh = Math.max(1, fontPx);

  if (seat.mode === "center") {
    return { dx: -tw / 2, dy: -fh / 2 };
  }

  const dy = heightDy(seat.height, fontPx, padY);
  if (seat.side === "right") {
    return { dx: gap + padX, dy };
  }
  return { dx: -gap - padX - tw, dy };
}
