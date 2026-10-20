# Report Builder — decided, built, drifted, and the order to close it

Written Oct 20, 2026, from `DECISIONS.md` end to end, checked against the live
deck on Janis Fensterer (15 Rabbitbrush) and against measurements taken today.

**No new ideas are in this document.** Every line is a decision already made,
with what the product actually does beside it. Tim: "You have me having to go
back and remember all of my decisions, and you don't seem to have the same
desire to make sure it's built with the decisions already made."

The finish line is Tim's, set the same day: **open Report Builder and find the
report 80–90% built.**

---

## 1. The site overview, and the Google Maps link

**Decided, Oct 3:** "Below CONTENTS sits the site aerial/overview image,
sourced from a Google Maps link built from the property address plus optional
paste/replace; **an empty dashed 'Site overview photo' hole is not the
finished look.**"

**Decided, Oct 10:** the cover's aerial belongs to the book, not the cover —
every Floor Survey page is handed it automatically, and an x takes it off one
page. "Once you put it in on the cover page it should automatically go in
there, and then if it's not right you just delete it."

**Today:** the overview box renders bottom-right with the dashed hole and the
Paste / Add buttons. **The Open in Google Maps link does not render at all**
on a cover with a real address — measured. So the one control that starts the
chain is missing, the box stays empty, and every Floor Survey sheet is handed
nothing. The feature reads as absent everywhere downstream from one broken
link at the top.

**Drift:** the entry point is broken, and the dashed hole that was explicitly
called "not the finished look" is what a client sees.

---

## 2. The colour scale and the H/L/Δ pill on a Floor Survey sheet

**Decided, Oct 5:** the legend is the exception to plan-proportional sizing.
"I don't want the legend to grow or shrink with the topo." It holds one size
however large the plan is drawn — the same size on every slide.

**Decided, Oct 17:** one scale and one pill **per boundary**, each a box on
the page, dragged on its own, sized by Legend size and Stats pill size, no
corner handles, and no outline until pointed at.

**Today, on the Combined sheet of a real job:** two scales, and the second one
runs off the bottom edge of the sheet — cut in half. The two pills are not
beside their scales; one floats near the top of the page, the other near the
bottom. On the single-boundary sheets the scale sits out in the white space
away from the drawing.

**Drift:** the per-boundary rule is built; the default placement of the second
boundary's pair puts it off the paper, and the pairs are not kept together.
This got worse today, because a sheet whose drawing now fills the page has
less margin for a box that was placed when the drawing was inset.

---

## 3. Pictures pages

**Decided, Oct 16:** a page opens on the grid that leaves the fewest empty
cells, no more than two rows deep; ten photographs to a page; the rows follow
from the page. The chosen grid is kept.

**Decided, Oct 9:** with the rail, five across gives a 2.52 × 3.36 in plate.

**Today:** the grid and the plate are right. **A long caption changes the size
of that cell's picture**, so the row stops lining up — Photo 31 with a
five-line caption, and Photo 67, both visible in the live deck.

**Drift:** no decision says a caption may resize a picture. The decided
principle everywhere else is the opposite: "Content sets the layout" is about
*rows growing*, and a text box's stored height is "the floor it starts at,
never a lid" — neither says a plate shrinks. **This one needs Tim's call**
between two readings of his own rule: every plate identical with the caption
shrinking to fit, or every plate identical with the row growing taller. He
offered the first: "maybe if we need to shrink the font size, we can do that."

---

## 4. Chevrons in the contents

**Decided, Oct 3:** "never double-prefix a figure title and **never use
chevrons**."

**Today:** each contents line carries a `›` jump control. It is on the
`TODO.md` list as an open item and has been for days.

**Drift:** a decision written down and not honoured.

---

## 5. Round handles that print

**Decided, Oct 9:** 90° corner pulls, not tiles; only while the surface is
selected; never on paper. Recorded as **outstanding** in `DECISIONS.md`: "Tim
is seeing round handles that print. Neither set in the code is round and both
are suppressed in print, so there is a third thing not yet found. To be
settled from a screenshot of the printed sheet."

**Today:** still open. It needs one screenshot of a printed sheet, which is a
thing to ask for rather than a thing to build.

---

## What is NOT drifted, and should be left alone

- **Book order** — Cover → Discussion → Floor figures → Picture Locations →
  Pictures. Correct on the live deck.
- **Contents** — Discussion first and not a figure; figures numbered by slide
  order; no double prefix. Correct.
- **"Corrected for Flooring Differences"** — proper English, Oct 16. Correct
  on the cover.
- **The rail on every figure page** — residence, address, drawing title,
  figure number, mark; compass only on drawings of the building. Correct.
- **Picture/Damage Locations** — no pre-printed empty rows, room in bold at
  the head of its note, Photo / # / Notes columns. Correct.
- **Readings in tenths**, the pill set once per device, the plate size, the
  per-level figure pages, autosave, undo, print. All correct.

---

## The order to close it

Ranked by what stops a report being handed to a client, not by what is easy.

1. **The Google Maps link** (§1). One broken control, and the whole site
   overview — cover and every Floor Survey sheet — is absent. Nothing else on
   this list fails as widely.
2. **The second boundary's scale running off the sheet** (§2). A cut-in-half
   colour key on a client's figure is the most obviously wrong thing in the
   deck.
3. **Pictures lining up** (§3) — once Tim says which of the two readings of
   his own rule he wants.
4. **The chevrons** (§4). Small, decided, and overdue.
5. **Round handles that print** (§5) — needs a printed-sheet screenshot
   first.

Then the composition pass that only Tim can drive: the cover he has said twice
he does not like, and the Discussion page that was never rebuilt. Those are
"screenshot → match → accept on a real Customer File", which is the review
loop `DECISIONS.md` already sets out and which is not something to guess at.

---

## How this document gets used

The failure this is written against is not any one of the five items. It is
that the decisions were already written down and the product was not checked
against them — Tim was left to find each drift himself, from screenshots, one
at a time.

So: **before saying what Toolbox does, read the record.** And this list gets
re-checked against the live deck at each checkpoint, not rebuilt from whatever
was noticed most recently.
