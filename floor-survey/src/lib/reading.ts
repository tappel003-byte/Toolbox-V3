/**
 * A reading, written the way it was taken.
 *
 * Floors are read in tenths of an inch, so a whole screen of 9.30, 8.90, 7.60
 * is a column of zeros that say nothing. Tim, looking at a Main Level of them:
 * "if we were only to show the tenths and not the hundredths this would really
 * clean up... we can still show the hundredths, but only if they're typed in.
 * If we don't have a hundredth typed in, then we don't show the zero."
 *
 * So the second place appears only when it carries something: 9.30 prints as
 * 9.3, and 9.15 prints as 9.15. One place is the floor — 9.00 prints as 9.0,
 * not 9, because a measurement with no decimal at all reads as a count.
 *
 * This is for the surfaces that show a reading as it was entered: the Data
 * plan and its list, Review, the point detail, the keypad's repeat, the
 * recovery PDF. Where a reading is *presented* rather than entered — Topo, the
 * H/L/delta pill, the colour legend, the figure rail, the report figures — it
 * is rounded to tenths, which is a different rule and stays as it is. See
 * DECISIONS.md "Readings are printed in tenths".
 */

/** The reading as text: one decimal place, two when the second is not a zero. */
export function readingText(value: number, min = 1, max = 2): string {
  if (!Number.isFinite(value)) return "—";
  const full = value.toFixed(max);
  const trimmed = full.replace(/0+$/, "");
  const dot = trimmed.indexOf(".");
  const places = dot < 0 ? 0 : trimmed.length - dot - 1;
  return places < min ? value.toFixed(min) : trimmed;
}
