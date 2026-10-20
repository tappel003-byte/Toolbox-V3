# Report Builder — where it actually is

Measured Oct 20, 2026, against the finish line Tim set the same day:

> "I have to be able to open up Report Builder to an 80–90% built report."

Nothing here is a new idea. It is what opening Report Builder on a finished
job does today, what it doesn't, and which side of the line each gap falls on.

## How this was measured

A Customer File was seeded the way a real job arrives: one level with a plan,
a Floor Survey with a closed boundary and twenty readings inside it, eight
Distress pins each with a photograph, and the level's contour layer present.
Report Builder was opened and every page looked at **without touching
anything**. Then the same job again with no contour layer on the level.

## What opens built, untouched

| Sheet | What is on it when it opens |
| --- | --- |
| **Cover** | Customer name, address, survey date, and the CONTENTS list built from the slide order. |
| **Discussion** | The sheet, its heading, survey date, address and orientation block. The body is blank — that is the investigator's writing, and it is not something the app can fill. |
| **Floor Survey** (one per figure) | The full title block — residence, address, drawing title, level, date. **The drawing itself is not there.** |
| **Picture Locations** (one per level with pins) | The plan, all eight pins in place, the level's contour underneath them, and the photo/notes schedule beside it, numbered. |
| **Pictures** | Every photograph on the job, placed on the sheet, captioned. |

So four of the five sheet types fill themselves in completely. The book, its
order, its numbering and its contents build themselves.

## The two gaps that stop 80–90%

**1. The Floor Survey drawing needs a button pressed, per level.** The sheet
opens with its title block and an *Import Floor Survey* button where the
drawing belongs. Everything needed is already on the page — the evidence is
attached when the report opens — but the figure is only drawn once that button
is pressed. On a three-level job that is three presses before the report looks
like a report. This is the single biggest thing between today and the finish
line.

**2. The contour is usually missing — but not because Report Builder drops
it.** Measured both ways: when the level has a contour layer, the Picture
Locations sheet draws it under the pins automatically, with no button and no
setting. When the level has none, it draws the plain plan. Report Builder is
doing its part.

The reason it is usually absent is upstream: the only way a level gets a
contour is the *Send to Distress Survey* button in Floor Survey's Topo tab, on
B&W lines only. Nobody remembers to press it, so the level holds nothing and
the report prints a plain plan. That is what the **Done taking points** idea on
the list fixes — and by the finish line it is finishing work, not a feature.

## What is not a gap

- **The Discussion body.** The investigator writes it. An empty writing area on
  a correctly built sheet is finished work.
- **Captions and pen-log notes.** Seeded from the pin and then edited. Working
  as intended.
- **The cover's aerial view.** It is a picture of the property that has to be
  chosen. The box is there and the choice is one click.

## Above the line and below it

**Above — finish these:**

1. The Floor Survey figure importing itself when the report opens.
2. Done taking points, so levels actually carry their contour.
3. The four look-at-it-together items already written down in `TODO.md`:
   the cover page ("I do not like the cover page at all"), the Discussion page
   that was never rebuilt, the chevrons in the contents and the empty dashed
   overview box, and bringing the colour scale, the H/L/Δ pill and the
   High/Low markers back onto an imported Floor Survey slide. Those four need
   Tim at a desktop looking at a real report — they are judgement, not code.

**Below — on the list, not during the build:** pin size, the Explorer items,
and everything else in the "On the list, not being built" section of
`TODO.md`.

## The honest number

Tim's estimate was 70%. Split in two, it reads better than that:

- **What fills itself in: about 90%.** Five sheet types, four of them complete
  on open, the fifth one button away.
- **What it looks like when it does: the 70%.** The cover, the Discussion
  page, and the chrome on a floor slide are the remaining work, and all three
  are a look-at-it-together loop rather than something that can be finished
  alone.

Which means the way to finish Report Builder is one short build (import and
contour) followed by one desktop session on the four appearance items — not a
long list of missing capability.
