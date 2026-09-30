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
