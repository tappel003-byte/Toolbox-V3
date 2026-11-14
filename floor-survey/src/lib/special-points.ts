// Readings that are kept, numbered and shown but are not part of the floor surface.
//
// A drain is cast low on purpose; a "monitor" reading is a spot worth watching over time (a slab
// that has curled up in one place, say) that would drag a bulge into the contours if it were
// contoured. Both are left out of the contours, the High / Low and the range, and both are drawn
// the same way: in parentheses, with the word for what it is under the number. The only thing that
// differs between them is that word, so the words live here and nowhere else. (Tim, Nov 14, 2026;
// "Monitor" is the working name until a better word is found: change it in SPECIAL_LABELS.)

export type SpecialKind = "drain" | "monitor";

/** The word printed under the number, and the name used in the note under the map. */
export const SPECIAL_LABELS: Record<SpecialKind, string> = {
  drain: "Drain",
  monitor: "Monitor",
};

/** Menu order after "Reading". */
export const SPECIAL_KINDS: SpecialKind[] = ["drain", "monitor"];

type MaybeSpecial = { special?: SpecialKind; isDrain?: boolean };

/** What kind of off-surface reading this is, if any. `isDrain` is how drains were saved before kinds. */
export function specialKindOf(p: MaybeSpecial | null | undefined): SpecialKind | undefined {
  if (!p) return undefined;
  if (p.special === "drain" || p.special === "monitor") return p.special;
  return p.isDrain ? "drain" : undefined;
}

export function isOffSurface(p: MaybeSpecial | null | undefined): boolean {
  return !!specialKindOf(p);
}

/** The line under the map, naming only the kinds the level has; null when it has none. */
export function specialNote(points: ReadonlyArray<MaybeSpecial>): string | null {
  const present = SPECIAL_KINDS.filter((k) => points.some((p) => specialKindOf(p) === k));
  if (!present.length) return null;
  const names = present.map((k) => SPECIAL_LABELS[k].toLowerCase());
  const joined = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `( ) ${joined.charAt(0).toUpperCase()}${joined.slice(1)} readings, not included in the topo`;
}
