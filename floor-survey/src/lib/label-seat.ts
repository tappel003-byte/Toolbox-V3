/**
 * Reading-label seats relative to a point.
 *
 * Free drag still writes labelDx / labelDy. A seat is a preset that parks the
 * number close to the dot; drag remains an override afterward.
 *
 * Layout (cross + center):
 *
 *           Top
 *   Left  Center  Right
 *         Middle   ← below the point
 *
 * Offsets are for the text's top-left corner (same convention Topo draws with).
 */

export type LabelSeat = "left" | "right" | "top" | "middle" | "center";

export const LABEL_SEATS: { id: LabelSeat; label: string }[] = [
  { id: "left", label: "Left" },
  { id: "right", label: "Right" },
  { id: "top", label: "Top" },
  { id: "middle", label: "Middle" },
  { id: "center", label: "Center" },
];

/** Gap between the dot and the label pill, as a fraction of font size. */
const GAP_RATIO = 0.22;

/**
 * Image-space offset (text top-left from the point) for one seat.
 *
 * `textW` / `fontPx` / pads match the drawn label box so the seat lands
 * where the eye expects — not a fixed (+8,+6) that drifts as the font grows.
 */
export function labelSeatOffset(
  seat: LabelSeat,
  textW: number,
  fontPx: number,
  padX: number,
  padY: number,
): { dx: number; dy: number } {
  const gap = Math.max(2, fontPx * GAP_RATIO);
  const tw = Math.max(0, textW);
  const fh = Math.max(1, fontPx);
  switch (seat) {
    case "right":
      // Pill's left edge just clear of the dot; text vertically centered on the point.
      return { dx: gap + padX, dy: -fh / 2 };
    case "left":
      return { dx: -gap - padX - tw, dy: -fh / 2 };
    case "top":
      return { dx: -tw / 2, dy: -gap - padY - fh };
    case "middle":
      // Below the point.
      return { dx: -tw / 2, dy: gap + padY };
    case "center":
      return { dx: -tw / 2, dy: -fh / 2 };
  }
}
