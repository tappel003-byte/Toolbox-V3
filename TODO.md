# Parked work

Things noticed, agreed to be worth doing, and not being done yet. Tim, Oct 15,
2026: "I don't want to think of these right now — put these on the list and
let's get back to them."

This is a holding list, not an authority. It decides nothing: `VISION.md` is
the product, `MILESTONE.md` is what is allowed to be worked on now, and
`DECISIONS.md` is what has been settled. An item here is only a reminder that
it exists, and nothing on it is approved to build until the product owner says
so.

---

## Waiting on a word from Tim

These are each a one-line answer, after which the work is small.

- **The old High/Low marker code.** One function that drew the High and Low
  markers as the report's own boxes. Nothing calls it — the markers point at a
  spot on the floor, so the drawing carries them. Bin it, or keep it as the
  material for a per-page rendition later? (The colour scale that sat beside
  it is gone: a sheet shows Floor Survey's own scale now. The H/L/Δ pill is
  live.)

## Wants Tim at the desktop

The Report Builder formatting rebuild is a look-at-it-together loop by its own
rule — screenshot, match, accept on a real Customer File. These are its open
pages.

- The cover page. Tim: "I do not like the cover page at all."
- The Discussion page, never rebuilt.
- The chevrons in the contents, and the empty dashed site-overview box.
- Bringing the colour scale, the H/L/Δ pill and the High/Low markers back onto
  an imported Floor Survey slide. They are switched off on purpose until the
  drawing underneath them is right.

## Findability

Built, working, and findable only by being told. Tim, on the contour layer:
"it almost feels like now it's inside information and only I'm gonna know how
to use it."

- **The contour layer.** Send only appears when the drawing is in
  black-and-white contour; the layers pill in Distress stays hidden until a
  contour exists.
- **The rail is editable.** Nothing says so; you have to click it and find out.
- **Two views on a floor sheet**, and **Lock view against Lock layout** — two
  different locks with nothing to say which is which.
- **Dot and text size**, behind the Data panel's collapse arrow.
- **Stats pill size**, behind the sliders icon in Topo.
- **Send to File Cabinet and Check In**, inside the three-dot menu.

## Where the Cabinet is heading

Raised by Tim, Oct 18, 2026, alongside the File Explorer decisions. Neither is
in the current milestone; both are written down so they do not evaporate.

- **Finding a job by what was in it, not just who it was for.** Tim: "let's say
  I wanted to find pictures of settlement for a website and I remember one in
  2022... maybe we have a description of what the job was — real estate
  inspection, settlement, 6 inches elevation difference, three-quarter inch
  drywall cracks." The words are already typed: pin notes, the report's
  discussion, the job type. The headline numbers need no typing at all — the
  biggest elevation difference and the span it crosses, how many levels, pins
  and photographs are all computable from the survey when a job is filed. One
  line of description per job at close-out covers the rest. The limit to state
  plainly: this searches what was *written* about a picture, never what is
  *in* it.
- **A map of filed jobs.** Tim: "what would be really, really cool — we drop a
  pin on a map with completed reports." The data is already captured: Set Base
  Point stores a GPS fix with its accuracy, and an address picked from the
  suggestion list stores its coordinates. So a job is placed from its base
  point where there is one, and from the address otherwise, with no new
  service. A map of customers' houses stays behind the same sign-in as
  everything else.

  Tim's vision for it, Oct 18: "as we grow we are going to build over the
  years -- it's 2026 now, in 2030 we'll have five years of pins on a map, and
  then I can always zoom into an area and then filter by year." So the map is
  a view of the catalogue with a date filter on it, not a second store: a card
  already carries the coordinates and the field work date. Two things that
  only matter at that size -- jobs in one neighbourhood cluster into a single
  pin with a count until you zoom in, and the year filter is a range rather
  than one year. The drawn streets underneath are a service call like the
  address lookup; the people already used for addresses serve map tiles too,
  so it is likely the same account rather than a new one.

## Open elsewhere

- **The Distress field checkpoint.** Floor Survey has one — its recovery PDF.
  Distress follows the same principle and has nothing built. Deliberately
  outside the sync foundation; still outstanding.
- **Take Over**, and the post-release **Remove From This Device / Keep Local
  Copy / Archive as Revision** choice. Both parked on purpose by
  `MILESTONE.md`.
- **A real job through a real Check Out.** Fred Keulen is the candidate the
  milestone names. Nothing has been proven on a real file yet, only in tests.

## Known, and not a defect

- **A gap in the point numbers.** Tim's Main Level list runs 1, 2, 4, 5 — no 3.
  Every delete path renumbers, undo and redo keep it contiguous, and it cannot
  be reproduced; every surface reads the same stored number, so nothing
  disagrees with anything else. Nothing repairs an existing gap, deliberately:
  renumbering would change what "point 4" means in a note already written. If
  it turns up again with a known cause, this is where it was last looked at.
