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

## The File Explorer list

Decided with Tim, Oct 18, 2026, looking at an opened job on his phone. The
contact sheet landed that morning; this is what is still on the list.

- **A folder view.** Real filenames, folders you walk with a breadcrumb,
  pictures as a sheet and everything else in a tight table. Tim: "Explorer
  needs to kind of look and feel like an actual Microsoft file explorer."
- **Open says what is in a component, not what it is made of.** Today Open on
  Distress, Floor Survey or Report Builder prints the raw file. Tim: "who in
  the world is this helpful?" It should read *Floor Survey -- 2 levels · Main
  Level 48 readings · surveyed Sep 29, 2026*, with Download still handing over
  the real file and the raw text behind Technical details.
- **A picture of the survey, before a PDF of it.** Tim: "I wonder if we just
  for this initially we just take screenshots of the floor level survey, of
  the distress survey." A picture of the drawing is readable by anyone, costs
  almost nothing, and can be replaced by a proper PDF later without changing
  where it lives. Floor Survey already makes a recovery PDF; Report Builder
  already prints one; Distress has nothing today.
- **The Cabinet index and the Trash record are not documents.** They sit in the
  list today as if they were things to open. They belong behind Technical
  details with the keys and the ids.
- **The readings CSV, and what X and Y mean.** Tim, on the objection that
  without a scale the positions are meaningless: "we have our starting point
  and we actually name it in the beginning, so if we have a starting point we
  at least have a layout." He is right. The base point is a named origin, so
  every reading is a true position relative to it -- the shape of the floor,
  which corner is low, how the slope runs -- and only the *units* are missing.
  The elevations are real inches either way. BP1 now carries a GPS fix and the
  front door's facing gives orientation, so origin, bearing and relative
  positions are all in hand; setting a level's scale is what turns them into
  distances on the ground.

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
- **A real job through a real Check Out.** Not untried, as this line used to
  say. Real jobs are in the Cabinet -- Chalmers Ford, Fred Keulen, Janis
  Fensterer, Jason Mitchell -- real reports have been built on them, and Tim
  checked a file in from his phone on Oct 17 after the refusal-reason fix. What
  has not been written down is a deliberate two-device round trip: check out on
  one device, work, check in, and confirm the other device sees the work and
  gives up its copy. Tim, Oct 18, on the old wording: "that's not all very
  true, is it -- what do you think I got screenshots from yesterday?"

## Known, and not a defect

- **A gap in the point numbers.** Tim's Main Level list runs 1, 2, 4, 5 — no 3.
  Every delete path renumbers, undo and redo keep it contiguous, and it cannot
  be reproduced; every surface reads the same stored number, so nothing
  disagrees with anything else. Nothing repairs an existing gap, deliberately:
  renumbering would change what "point 4" means in a note already written. If
  it turns up again with a known cause, this is where it was last looked at.
