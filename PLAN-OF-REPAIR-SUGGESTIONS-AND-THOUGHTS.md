# Plan of Repair — Suggestions and Thoughts

**Working document.** Collect suggestions from Cursor, Claude Code, ChatGPT, and anyone else Tim asks. Compare them here. **Consensus is Tim’s** — when he locks a direction, record it in this file’s Consensus section, then promote durable decisions into `DECISIONS.md` / `SESSION_STATE.md` as needed.

This file is **not** product authority until Tim marks a consensus. Authority order remains: `VISION.md` → `AGENTS.md` → `MILESTONE.md` → `DECISIONS.md` → `SESSION_STATE.md`.

Started: **Nov 8, 2026** (America/Denver)  
Purpose: stop debating POR as a Report Builder template; decide what the drawing app is, what’s broken, and how to get there.

---

## How to use this file

1. Paste each model’s contribution into its section (or attach a dated subsection).
2. Do not silently merge models into one voice — keep attribution.
3. When Tim says the direction is decided, fill **Consensus (Tim)** below.
4. Only after consensus: implementers may treat that block as the go-forward product sentence and slice order — still wait for an explicit “go” / “build it” before coding.

---

## Tim’s frame (as stated Nov 8, 2026)

- Too much focus on making a **template**.
- Change focus: Plan of Repair should be its **own kind of standalone app within the app**.
- Less about template; more about **functionality and maneuverability**.
- Target feel: **almost like Microsoft Paint / PowerPoint** — “I just want a drawing page.”
- He does not think we’re there yet.
- He is gathering suggestions from multiple AIs (Cursor, Claude Code, ChatGPT / Joyce) and will come to a consensus here.

---

## Consensus (Tim)

*Empty — Tim fills this when ready.*

| Locked? | Decision |
|---------|----------|
| — | Product sentence |
| — | What it is / is not |
| — | First build slice |
| — | Explicit non-goals |

---

## Cursor’s position (Nov 8, 2026)

### Product sentence

Plan of Repair is the Customer File’s **standalone drawing app** for repair / underpinning sketches on a floor plan or contour.

It is **not** a Report Builder template with ink tools glued on.

Same doorway (Customer File → Plan of Repair). Same save home (`record.planOfRepair`, sync component `repair`). Different job: **maneuverability on a drawing surface** — not layout fidelity to Report Builder.

### What it SHOULD be

- A drawing-first workspace inside an open Customer File
- Closer to Microsoft Paint + PowerPoint than to CAD, forms, or report composition
- Big working surface; plan or contour as background; marks Tim can put down, move, nudge, resize, rotate, copy, stack, undo
- Desktop-first professional sketching for preliminary repair plans
- Local-first; offline with the Customer File; no cloud required to draw
- Small reusable stamps for marks Tim actually uses (pier circle, circle-in-square, arrow, note) — not a pier database
- Print/PDF when needed, but print chrome must not define the editing experience

### What it should NOT be

- An RB-style “drawing template” whose success metric is matching RB chrome
- A second Report Builder (must not write into `reportBuilder`)
- A redesign of Distress, Floor Survey, Customer File, or sync
- CAD / engineering analysis software
- A phone-layout project
- Live collaboration / CRDT / new cloud services for drawing
- A heavy symbol library or pier catalog
- More permanent Format-panel chrome when the real gap is moving marks on the plan

### What’s broken / wrong with the current focus

1. **Wrong north star** — Shipping framed POR as “RB-style drawing template” (#188 → #189). Effort went to inherited shell (RB identity, format-tool host, title rail, dense Format/Drawing panel, report-like page chrome). Tim’s need is functionality and maneuverability, not template likeness.

2. **Drawing loop friction (core product failure)** — Tool-arming / selection is fiddly. Tools can stay armed and stack accidental shapes; Format then edits the wrong object. Paint/PowerPoint succeed because select → manipulate → draw next is fluid. Until that loop is fixed, new shape types won’t feel like a drawing app.

3. **Chrome competes with the canvas** — Permanent right-hand form density and RB-like ribbon fight “just a drawing page.” Toolbox rule: protect the working surface. POR currently protects the template metaphor instead.

4. **Maneuverability gaps that matter** (not a full wishlist):
   - Weak pan/zoom ownership of the sheet (Fit/−/+ ≠ PowerPoint canvas navigation)
   - No reliable one-shot draw / auto-return to Select
   - No arrow-key nudge (and likely weak Shift-constrain habits)
   - No rotate of selected shapes (compass/north exists; shape rotate does not)
   - Limited stamp/mark vocabulary for real repair sketching (legacy pier symbols migrated to circles; workflow not replaced with a good stamp strip)
   - Multi-select / group / align absent (PowerPoint jump — after the basic loop)
   - Picture insert stubby; text boxes thinner than PowerPoint text objects
   - Duplicate-in-place / paste-in-place may be weak vs offset paste only

5. **What is NOT the main problem** — Missing a thousand shape types; not looking enough like Report Builder (looking too much like it is); sync architecture.

### How Cursor would fix it (ordered slices)

Each slice must prove maneuverability on a real Customer File after merge/promote. No chrome-only passes. No “closer to RB.”

| Slice | Name | User-visible win |
|-------|------|------------------|
| **A** | Interaction loop | Place a mark and adjust it without the tool fighting you. After a shape finishes → return to Select (or true one-shot tools). Empty click clears selection; shape click selects without starting a new draw. Kill accidental stacked shapes. |
| **B** | Maneuver basics | Get a pier exactly on the footing. Arrow-key nudge (Shift = larger step); Shift-constrain where natural; rotate selected shape; pan + zoom that feels owned (keep Fit). |
| **C** | Stamp strip (tiny) | Sketch a preliminary underpinning plan in minutes. 4–6 fixed stamps Tim actually uses; click stamp → click plan; then Select. Same overlay model; no pier database; no RB write. |
| **D** | PowerPoint jumps | Arrange a cluster of marks like a slide. Multi-select + Group; align/distribute; Ctrl+D; paste-in-place; better in-place text. Only after A–C. |
| **E** | Later / optional | Guides/snap; dashed lines / arrowheads / opacity; image paste as sheet objects; quieter shell (inspector only when selected). Polish — not the definition of done. |

### Cursor refusals

- Do not merge POR into Report Builder
- Do not rebuild POR as another report template pass
- Do not start with a giant symbol library
- Do not add cloud/collab/CAD scope to “make it better”
- Do not spend the next slice on title-rail visual fidelity

### Success test for a slice

On a real Customer File, with a real plan/contour: place marks, move them, nudge them, undo, copy a cluster, adjust without accidental extra shapes. If that feels like a small drawing app, it worked. If it only looks more like Report Builder, it failed even if tests pass.

### Reframe

| Old lens | New lens |
|----------|----------|
| RB-style drawing template | Standalone drawing app inside Customer File |
| Match RB chrome | Borrow code only when it helps drawing |
| Sheet + rail as product | Maneuverability as product |
| Format panel always on | Tools/inspector when drawing/editing |
| “Looks like a report page” | “I can sketch a repair on this plan” |

### Questions Cursor wants answered before the next build

1. Confirm product sentence: standalone drawing app inside Customer File — not RB template?
2. Slice A (select/draw loop) first — yes or different first slice?
3. Which 4–6 stamps are the real set for v1?
4. Must shape rotate ship with nudge, or can rotate follow?
5. How much RB chrome can leave POR (title rail density, permanent Format panel) without breaking print needs?
6. Is Print/PDF “good enough” export for now if editing feel is fixed?
7. Any mark types that must look identical to legacy pier symbols from migrated docs?

---

## Claude Code’s position

*Paste Claude Code’s audit / suggestions here (dated).*

---

## ChatGPT’s position

*Paste ChatGPT’s audit / suggestions here (dated).*

---

## Joyce / synthesis notes

*Paste Joyce’s notations and cross-model summaries here as Tim gathers them.*

---

## Comparison scratchpad

Use this table as suggestions arrive. Do not treat filled cells as consensus.

| Topic | Cursor | Claude Code | ChatGPT | Tim lean |
|-------|--------|-------------|---------|----------|
| Product identity (app vs template) | Standalone drawing app in CF | | | |
| First slice | A — select/draw loop | | | |
| Stamps vs symbol library | Tiny stamp strip | | | |
| RB chrome | Borrow only if it helps drawing | | | |
| Multi-select / group | Slice D (after basics) | | | |
| CAD / cloud / collab | Refuse | | | |

---

## Implementation gate

No Plan of Repair code changes from this document until:

1. **Consensus (Tim)** above is filled for product sentence + first slice, and
2. Tim says **go** / **build it** / **do it** on a specific slice.

Discussion and pasted suggestions are not authorization.
