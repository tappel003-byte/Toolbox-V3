# File Explorer rebuild — the drawings and what they decide

**The first slice of this is now built** (Tim authorized implementation,
Oct 28, 2026). The drawings stay exactly as they were — they are the design,
and the build is measured against them, not the other way round. What has
landed and what has not is in **"Where the build has got to"** below.

`VISION.md` is the product, `MILESTONE.md` is what may be worked on now, and
`DECISIONS.md` is what has been settled. This folder exists so the design work
survives — a conversation was compacted once already and these drawings were
nearly lost with it.

Tim, Oct 23, 2026: *"we almost lost the file explorer stuff yesterday… can you
somehow make sure we retain that information."*

---

## The drawings

`explorer-mockups.html` — open it in a browser. Seven screens, phone first and
then desktop. It is a picture of the app, not the app: nothing in it is wired
to anything.

Also published, if the file is easier to reach as a link:
<https://claude.ai/artifact/VvBNqz1Ubs6gcfRMveVXR2>

| Screen | What it shows |
| --- | --- |
| Filed, by year and month | Working and Filed are separate drawers. A finished job leaves the working list and lands here, filed by its floor survey date. |
| The pin map | The same drawer on a map instead of in a list. Pins come from the base point's GPS, or the address — both already captured. |
| Inside a filed job | What survives Toolbox disappearing: a PDF of each survey, the readings as a CSV, every photograph under a name a person can read. |
| Filed jobs, with a details pane *(desktop)* | Drawers and years are the tree. The middle is a sortable list; the right pane carries figures the survey already knows, so a job can be judged without opening it. |
| The map, with room to use it *(desktop)* | The whole state at once, a year range along the top, the selected cluster listed beside it. Zoom in and clusters split into single pins. |
| Inside a filed job, with a preview *(desktop)* | The job opens as folders in the tree. Pick a file and it previews on the right, so a survey can be read without downloading it. |

## Where the build has got to

Built, and in the application:

- **A job says what it holds.** The job view leads with what the survey
  records — levels, readings, pins, photographs, the survey date, the biggest
  fall — and every folder says what is inside it before you walk in ("Floor
  Survey · 3 levels · Main Level 48, Basement 31 · surveyed Oct 7, 2026").
  Open on one of Toolbox's own records leads with that sentence and puts the
  record syntax behind one closed line. Tim: *"who in the world is this
  helpful?"*
- **The readings CSV and the pin list**, as real files in the copy. The CSV
  carries the raw reading, the correction applied and the corrected
  elevation, the last from Floor Survey's own `withCorrectedValues` rather
  than a second copy of the arithmetic.
- **A recovery copy arranged for a person**: one folder named for the
  customer, the address and the field work date; photographs under the names
  the investigator gave them; Plans, Floor Survey, Photographs, Technical.
  A README that says what the survey records and what is **not** in the
  folder. Truthful progress while it packs, and a truthful count after.
- **The three columns on a desktop** — the tree down the left grouped by year
  and month, the list in the middle, the details and the preview on the
  right. The phone keeps the list it already had.

Not built, and why:

- **Working and Filed as two drawers.** Decided, and the tree is shaped for
  it, but what moves a job between them is a completed mark at Check In that
  nothing writes yet. Building the mark is a lifecycle change, not Explorer
  work, so the tree groups every job it can see and the split is a filter
  waiting for it.
- **The pin map.** Needs a decision on whether it plots on a tile provider or
  a plain state outline with no network dependency.
- **PDFs and the CSV written at filing time.** Today they are built when the
  copy is taken. `DECISIONS.md` records that *when* they are built is not
  decided.
- **A PDF of the Distress Survey.** Toolbox does not produce one. The copy
  says so rather than leaving the line out.

## What the drawings assume

These are the design's own premises. Each is a decision Tim can overturn in a
sentence; none has been separately confirmed.

Several have since been **decided** in `DECISIONS.md` ("The File Cabinet is
the repository", Oct 18, 2026): the two drawers, completed marked at Check In,
filing by the floor survey date with the distress date as the only fallback,
the card catalogue, and the readings CSV. The filing-date rule is already
implemented — `js/sync.js fieldWorkSurveyDate` writes it onto the Cabinet
index, and the tree reads it from there.

- **Completed is marked at Check In.** The checkmark is what moves a job out of
  the working drawer and up into Explorer.
- **Filed by the floor survey date** — the distress survey date when there is
  no floor survey. No third fallback.
- **Search reads the card catalogue, not the jobs**, so it stays instant at
  five thousand jobs.
- **The map is a view of that catalogue with a date filter on it**, not a
  second store. The coordinates are already being captured.
- **Delete lives here only.** A job with work in it can be destroyed from
  Explorer and nowhere else.
- **The figures in the details pane are computed, not typed** — levels,
  readings, pins, the biggest drop and the span it crosses all come out of the
  survey when the job is filed.

## The one thing the drawings decide

The PDFs and the CSV are **real files, written when the job is filed** — not
something rendered when you look at them. That is what makes the ZIP worth
anything if Toolbox is gone.

## How this sits against what is already settled

`AGENTS.md` already fixes File Explorer's role, and the drawings must not be
read as changing it:

> **File Explorer** is the server back door. It is not a second Customer File
> editor — it does not edit survey data, check a file out as ordinary work, or
> materialize a working copy. It is where the two back-door actions live:
> **Take Over** and **Delete** (CHANGED by Tim, Oct 22, 2026).

Reading and filing is what these screens add. Nothing in them edits a survey.

## Open, and needing a word from Tim before any of it is built

- Whether Filed is a real second drawer in the Cabinet or a view over the one
  it has.
- Where the filing figures are computed and stored — at Check In, on the
  Worker, or on demand.
- Whether the map needs a tile provider at all, or plots on a plain state
  outline with no network dependency.
- What a filed job's ZIP is actually called and what is inside it, since that
  is the artifact the whole design is for.
