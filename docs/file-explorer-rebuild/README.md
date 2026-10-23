# File Explorer rebuild — the drawings and what they decide

**This is a plan, not an authorization.** Nothing here is approved to build.
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

## What the drawings assume

These are the design's own premises. Each is a decision Tim can overturn in a
sentence; none has been separately confirmed.

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
