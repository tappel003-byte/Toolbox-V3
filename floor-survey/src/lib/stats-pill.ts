/**
 * The typography of the H / L / Δ readout.
 *
 * The same three numbers are drawn twice: as the floating chip in the corner
 * of the field screen (StatsChip, HTML) and as a pill on the drawing itself,
 * one per boundary (TopoTab, canvas). Two renderers, because they sit on two
 * different surfaces -- but one readout, so what decides how it reads lives
 * here instead of being typed into each.
 *
 * Tim, from the field: "this one shown is not tight." Measured against the
 * shipped Mitchell deck, which is what a tight one looks like, the field chip
 * was loose two ways. Its type was 0.42 of the chip's height where the deck
 * sets it at about 0.48, so the numbers floated in a halo of white; and its
 * digits were monospaced, which hangs air either side of a 1 -- "9.40" came
 * out half again as wide as the deck sets it. Tighter here is not smaller:
 * the type is larger in the same chip, and the air around it is what went.
 *
 * The deck's measurements, from ppt/media of the Mitchell Residence figure:
 * a 26px pill with a 9px cap height, about 6px of padding each side of every
 * divider, "H 9.40" spaced and "Δ1.50" closed up, each reading in the colour
 * of its own letter.
 */

/** Type size as a fraction of the pill's height. */
const FONT_RATIO = 0.46;

/** Padding each side of a segment, as a fraction of the pill's height. */
const PAD_RATIO = 0.14;

/** Type size for a pill of this height, in the same units as the height. */
export function statsPillFont(height: number, min = 4): number {
  return Math.max(min, height * FONT_RATIO);
}

/** Padding each side of a segment, in the same units as the height. */
export function statsPillPad(height: number, min = 2): number {
  return Math.max(min, height * PAD_RATIO);
}

/**
 * The colours of the readout.
 *
 * A reading takes the colour of its own letter -- the same red and blue the
 * High and Low markers use on the plan, so the eye joins the pill to the pins
 * without being told. That is how the shipped decks set it, letter and number
 * alike; the field chip was greying the number out on its own.
 */
export const STATS_PILL_COLORS = {
  hi: "#b51d16",
  lo: "#1f5f9f",
  delta: "#6b7280",
  label: "#6b7280",
} as const;

/**
 * One segment's text. The letter is spaced off its reading, except Δ, which
 * closes up against it -- "H 9.40", "L 7.90", "Δ1.50", as the decks read.
 */
export function statsPillText(letter: "H" | "L" | "Δ", value: string): string {
  return letter === "Δ" ? `${letter}${value}` : `${letter} ${value}`;
}
