/**
 * Keep a chosen on-screen size readable when the plan is fit-to-window or zoomed.
 *
 * Older formula used sqrt(zoom) with a 0.5× floor, so a large desktop fit
 * (scale ≪ 1) shrank 11px labels to ~5–6px. Investigators saw "fine on iPad,
 * tiny on desktop." Hold the chosen size when zoomed out; grow gently when
 * zoomed in so labels don't explode.
 */
export function screenAnchoredSize(
  base: number,
  viewScale: number,
  opts?: { minFactor?: number; maxFactor?: number; zoomPower?: number },
): number {
  const z = viewScale > 0 ? viewScale : 1;
  const minFactor = opts?.minFactor ?? 1;
  const maxFactor = opts?.maxFactor ?? 2.5;
  const zoomPower = opts?.zoomPower ?? 0.35;
  const factor = z >= 1 ? Math.pow(z, zoomPower) : 1;
  return Math.min(base * maxFactor, Math.max(base * minFactor, base * factor));
}

/** Image-space px so `base` lands near that many CSS pixels on screen. */
export function screenAnchoredImageSize(
  base: number,
  viewScale: number,
  opts?: { minFactor?: number; maxFactor?: number; zoomPower?: number },
): number {
  const z = viewScale > 0 ? viewScale : 1;
  return screenAnchoredSize(base, z, opts) / z;
}

/**
 * Presentation sizing: a size that is a fixed fraction of the plan.
 *
 * Distress Survey has always done this -- a pin is 0.9% of the plan's long
 * side, so it looks the same at any zoom, on any screen, and on paper. Floor
 * Survey's High/Low markers and colour legend were written as raw image-space
 * numbers instead, which is nearly the same thing but anchored to nothing: an
 * 11 px marker is 1% of an 1100 px plan and 0.44% of a 2500 px one, so the
 * same marker was a different size on every job, and on a report slide (where
 * the plan is scaled down to fit a page) it shrank to a speck.
 *
 * `base` keeps its old meaning -- the size that looked right on a plan
 * REFERENCE_PLAN_LONG_SIDE across -- so stored settings and the steppers that
 * edit them carry over unchanged. What changes is that the number is now
 * relative to something.
 */
export const REFERENCE_PLAN_LONG_SIDE = 1100;

export function planProportionalSize(base: number, planLongSide: number): number {
  if (!(planLongSide > 0)) return base;
  return base * (planLongSide / REFERENCE_PLAN_LONG_SIDE);
}

/** The long side of a plan, in image coordinates. */
export function planLongSide(planWidth?: number | null, planHeight?: number | null): number {
  const w = typeof planWidth === "number" && planWidth > 0 ? planWidth : 0;
  const h = typeof planHeight === "number" && planHeight > 0 ? planHeight : 0;
  return Math.max(w, h) || REFERENCE_PLAN_LONG_SIDE;
}
