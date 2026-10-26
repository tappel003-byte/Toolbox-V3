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

**The rebuild drawings live in `docs/file-explorer-rebuild/`.** Seven screens,
phone and desktop, with the premises they rest on written down beside them --
Working and Filed as separate drawers, filing by the floor survey date, the
pin map as a view of the card catalogue, and the PDFs and CSV written as real
files when a job is filed rather than rendered on demand. Open
`explorer-mockups.html` in a browser.

They are in the repository because the conversation that produced them was
compacted and they were nearly lost with it (Tim, Oct 23, 2026: "we almost
lost the file explorer stuff yesterday"). They decide nothing on their own and
none of it is approved to build.

- ~~**A folder view.**~~ Built Oct 20. A job opens as a list of folders saying
  what is in each, one is open at a time, and the path across the top is the
  way back up. Pictures are a contact sheet inside a folder. What is still
  not there: real stored filenames rather than what Toolbox calls a thing,
  and folders inside folders.
- ~~**The code files, out of the way.**~~ Built Oct 20. The record files are
  at the foot of a job behind one closed Technical details line, still
  downloadable. Tim: "see the code like Neo in the Matrix."
- ~~**Save it where I point it.**~~ Built Oct 20. Every Download in Explorer
  opens a Save As dialog, so a copy lands on the office server, an external
  drive, a flash drive or Drive. Chrome and Edge on a desktop; everywhere
  else falls back to the ordinary download. Tim: "I could be saving it to a
  Google Drive... that's a good idea."
  Still on the list, from the same conversation: saving as *folders* rather
  than one ZIP (the same dialog can hand back a folder, which PGG never
  did); choosing what goes in the copy -- whole job, pictures only, report
  only; saving just what you are looking at; a readable cover sheet inside
  the copy so a folder opened in 2031 explains itself; and a progress line
  while a big one is packed.
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
- **What a filed job shows, and what it hides.** Tim: "when the report is
  completed that is a source of truth... I don't want all of that code, that
  doesn't mean anything to me -- it might just be, down the road, if I still
  have all of these things that will mean something to [Toolbox] but not
  really anything else." So the drawer shows the report, the floor survey
  picture and its readings, the distress map and its pin list, the
  photographs and the plans. The component files stay stored -- they are the
  only thing that could rebuild a job inside Toolbox -- but behind Technical
  details, with Download still handing them over. One distinction to hold on
  to: the report is the source of truth for what was *concluded*, the
  readings for what was *measured*, and a dispute years later wants both.
- **Distress gets the same pair as Floor Survey.** The picture map -- the plan
  with its numbered pins -- and the pins as a readable file: pin number,
  level, room, the note, and which photographs belong to it. That is what
  makes "find the half-inch cracks" work, and it is the same material the
  report's Picture/Damage Locations page already carries.
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

## On the list, not being built

Agreed with Tim, Oct 20, 2026, after the second conversation in two days that
would have added work to Report Builder: "Report Builder continues to not get
finished because we continue to add new features. I don't know if we should
add new features during the build process when Report Builder isn't even
completed." Things land here until Report Builder is finished.

- **Done taking points.** Tim, Oct 20: "when we drop our first appointment for
  survey it says is this your first point, capture GPS etc. When we drop our
  last point there really is no complete. If we had a complete -- I'm done
  taking points -- generate the contour immediately, it could hit save.
  Closing out all the points could actually be a trigger for a lot of things."
  Floor Survey has a beginning and no end, so there is nowhere for the work
  after it to hang. A Done button on a level files the black-and-white contour
  for that level and takes the Save checkpoint. That is the whole trigger:
  "send to Distress" and "into Report Builder" are not separate steps, because
  the contour is filed on the **level** and both apps read the level.
  It is not a state and not a lock. Press it again tomorrow after adding
  points and it redraws -- no prompt, no edit-versus-add branch. Tim, on the
  version with a prompt: "I think you're trying to make this more complicated
  than maybe it should be." He is right; the button is the whole thing.
  One thing worth keeping, which costs nothing: a contour already records how
  many readings it was drawn from, so a level holding more readings than its
  picture can say the contour is behind rather than printing a stale one
  quietly.
  Today the contour is drawn by a button in Floor Survey's Topo tab, on B&W
  lines only -- "what you see is what you send", Tim's own call. That button
  stays; a step that can be forgotten must not be the only way.

- **Pin size, one number per level.** From PGG photo documentation, pull
  request #2 -- a slider from 0.3x to 2.5x with a Reset, 1.0 being the size
  for a ~2,500 sq ft plan. Tim's reason is capture, not print: "if I'm working
  on a 100,000 square-foot facility in Distress Survey the pins can just bunch
  up with each other until it gets lost, even in the capture... I have gone
  from a 100,000 square-foot facility to a 1,500 square-foot home with PGG in
  the same week."
  Settled in the discussion: **one number, two controls, never two numbers** --
  the legend and the H/L/delta pill each had two sizes until Oct 19, and the
  page drew one while a drag applied the other. The number belongs on the
  **level**, beside its plan, its front door and its north, because both
  Distress and Report Builder already pull the level, and a house and a
  detached shop in one job each get their own.
  What it meets in V3, read Oct 20: pins are sized in three places, not PGG's
  two -- the survey screen (plan's long side x 0.009, inline), the exported
  picture map (x 0.00875, inline), and Report Builder's pen-log sheet, which
  redraws the pins itself at 1.75% of the plan's long side, matched on purpose
  to the survey's export. V3's survey copy is older than PGG's: it has no
  `onScreenPinRadius()` or `exportPinRadius()` to multiply, so the multiplier
  goes in at the two inline spots. The likeliest way to ship this broken is
  the host bridge: `hostPersistSurvey()` and the loader beside it copy a named
  list of fields between the Customer File and the survey, so a new field is
  silently dropped and the slider resets the moment you leave the screen. Also
  needed: the Edit pin button is disabled until the first pin exists, which is
  the same thing PGG's own commit had to fix so the size can be set first.

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

- **Running out of memory on a real job. Found, and fixed.** Tim and Lee,
  moving between Pictures, File Explorer, Distress, Floor Survey, Report
  Builder and Diagnostics on one file, hit "Aw, Snap! Out of Memory". Two
  separate causes, both now fixed:
  one listener the formatting ribbon left on the page per visit, each holding
  a whole report (`tests/report-builder-teardown.mjs`); and Report Builder's
  undo history, which wrote the entire job -- photographs and all -- into
  every step. On a job with sixty photographs one step was 54 MB and six
  ordinary edits took the tab from 74 MB to 874 MB
  (`tests/report-builder-undo-memory.mjs` holds it at 0.08 MB a step).
  Two lessons worth keeping. First, a leak and a size are different problems
  and look the same from outside: laps of entering and leaving a workspace,
  measured with a forced collection, were flat the whole time the real fault
  was sitting in plain sight, because it only shows when the report is
  *edited*. Second, measure with a real forced collection through the
  debugger -- `window.gc()` on its own gave readings that looked like 80 MB
  of retention and was not.
  What the workspaces cost when nothing is being edited, for reference:
  library 6.5 MB, Distress 9.7, File Explorer 7, and everything comes back
  when you leave. Three laps is not enough to measure any of it -- the first
  visit's one-off load cost dominates.

- **A gap in the point numbers.** Tim's Main Level list runs 1, 2, 4, 5 — no 3.
  Every delete path renumbers, undo and redo keep it contiguous, and it cannot
  be reproduced; every surface reads the same stored number, so nothing
  disagrees with anything else. Nothing repairs an existing gap, deliberately:
  renumbering would change what "point 4" means in a note already written. If
  it turns up again with a known cause, this is where it was last looked at.


## Report Builder — flexible survey views on a sheet

**Design target recorded with Tim, Oct 25, 2026. Implementation is not authorized by this entry.**
Keep this entry with the [read-only code audit](REPORT-BUILDER-VIEWS-WORKFLOW-AUDIT.md).
That audit inspected `b6aea91f151adf3e187f532afbfaa0e6415329eb`; it read code/test
sources and did not run tests. The audit describes the existing implementation;
this entry preserves the intended experience. Do not confuse the two.

### What it should look and feel like

Tim previously took screenshots of the survey programs and arranged them in
PowerPoint. That gave him composition freedom but often caused inconsistent
sizes and alignment. Report Builder should provide that freedom using views
of the Customer File's survey data, with reliable alignment and output.

**Add a view, select it, adjust it, line it up.** The interface should not
require the investigator to understand slots, cameras, or internal layout fields.

- A sheet can contain the survey views the investigator needs, rather than
  being limited to one level shown once or twice. Examples: Main Level color
  contours beside Main Level readings; Main Level beside Second Floor.
- Add or copy an individual view. Choose which existing level and survey
  presentation it shows. Copying a view is different from duplicating a whole
  report sheet. More than two views must be possible; no numerical maximum
  was chosen in this discussion.
- Selecting a view directs its appearance controls to that view. One can show
  contours and another readings without changing the other.
- Move and resize views as composed objects. Side-by-side views should look
  intentionally matched: equal intended displayed heights and aligned top and
  bottom edges. Resizing a linked view resizes its companions; alignment/grid
  snapping supports moving them without small accidental offsets.
- Frames should fit the drawings closely enough that unnecessary white space
  does not dictate the composition. Account for image margins, framing, and
  frame shape separately. Preserve plan content and labels; removing evidence
  is not a white-space solution.
- Presentation and the saved PDF must preserve the arrangement and displayed
  information. The deliverable remains **11x17 landscape**.

### Flexibility clarification — Tim, Oct 25, 2026

Tim: "I'm not looking for 100% repeatability I am also looking for flexibility."

- Independent views/compositions are part of the target, not a failure to follow
  a template. Shared placement and linked resizing help when wanted; they must
  not force every view or every report sheet into the same arrangement.
- A reference/comparison sheet may bring together the garage, different levels,
  or other chosen survey views on one sheet. Tim can arrange the drawings
  together without contour legends or High/Low/Delta pills when those are not
  useful to that composition. Hidden reference elements must not require
  reserving their otherwise empty positions.
- Support both matched, linked side-by-side views and deliberately independent
  arrangements. Do not turn the earlier alignment examples into a mandatory
  link between every view. The exact link/unlink interaction remains to be
  designed simply.
- The code's existing "Combined" means boundaries within one level. That is
  not the same capability as Tim's proposed composition of multiple levels or
  selected views on one sheet. Preserve this distinction in implementation
  discussions.
- Tim has now explicitly named independent views as a need. The remaining
  detail is what independence includes in each case (position, size, and/or
  pan/zoom), not whether composition flexibility is required.

### Shared placement and the rail

- Shared arrangement across related floor slides remains the normal workflow.
  A simple **This slide only** on/off control is the proposed way to choose
  separate placement and return to shared placement. Tim suggested a floating
  pill near a canvas corner, outside the drawing area.
- Tim does not find **Use this as my default** useful for different jobs whose
  plans rarely have the same shape. Removing that decision from the ordinary
  rail is the proposed simplification; do not delete existing saved defaults
  or migrate reports as an unrequested side effect.
- No separate Lock action should be required merely to make sibling slides
  share an arrangement. Do not revive the old confusing lock controls.
- Reuse the conceptual organization of the new FS Control panel in the Report
  Builder rail: **Contours, Readings, Legend & H/L**. Contour colors belong under
  Contours; reading font size, bold, color and number formatting belong under
  Readings. Report Builder has different space and does not have to reproduce
  the field accordion presentation.
- **Data capture controls are outside this work.** Tim explicitly parked that
  discussion. Do not regroup the Data screen or change field capture,
  measurement storage, or correction behavior as part of report composition.

### What is already there, and what remains

The audit finds a same-level two-view feature, per-view appearance and
selection, a shared report camera, whole-page duplication, shared placement
and a per-slide placement exception, and a still-composition print path.
These are reusable capabilities, not proof that arbitrary compose is built.

Open backlog (flexible compose finish — Cursor finish branch; see
`docs/AI-REVIEW-LOG.md` CURSOR handoff after GPT-029 / PR #132 merge):

- [x] Individual view selection/source/copy: choose the floor and rendition
  for each view, mix floors on a sheet, and add beyond the current two slots.
- [x] Placement and sizing: move/resize individual view frames with linked
  sizing and reliable top/bottom alignment.
- [x] Snapping and whitespace: define and demonstrate alignment behavior and
  useful frame fit without clipping evidence.
- [x] Shared placement UX: simplify to the normal shared arrangement and an
  explicit This slide only exception; remove ordinary floor “Use this as my
  default”; preserve existing saved defaults.
- [x] Report rail: Contours / Readings / Legend & H/L; selected-view lead.
- [x] Persistence/output: views, settings, geometry, links, Present, PDF
  (acceptance on finish branch; GPT final review before merge).

### Questions still open — do not invent answers

- Whether matching different floors means equal displayed drawing heights,
  the same physical drawing scale, or a choice between them. Those are not
  interchangeable; source images can have different sizes and margins.
- How linked groups and independent placement interact with shared placement
  across report slides when slides contain different combinations of views.
- Which aspects of a view can be independent or linked (placement, size,
  pan/zoom), and how the investigator chooses that without adding confusing
  modes. Independent compositions are explicitly wanted; independent pan/zoom
  for every view is not automatically implied.
- Exact snapping targets/grid spacing and behavior for differently shaped
  plans; the final names/placement of Add/Copy and This slide only controls.

### Keeping this backlog useful

Keep active entries short enough to find and link detailed evidence or mockups
where they exist. Work is not complete just because code was written: record
relevant verification and Tim's acceptance where visual behavior is involved.
Then remove the completed item from the active checklist and cite its
implementation/verification in the completion record; Git history retains the
original discussion. Do not erase the preserved design or old evidence.

The File Explorer redesign is already retained in
[docs/file-explorer-rebuild/](docs/file-explorer-rebuild/README.md), including
`explorer-mockups.html`. It remains deferred, not lost or authorized by this
Report Builder discussion.
