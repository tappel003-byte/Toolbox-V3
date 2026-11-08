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

### Cursor cut-and-paste prompt (for Joyce / ChatGPT / other models)

Tim shares this packet so other models can notate Cursor’s position without rewriting it. Paste the fenced block below as-is into ChatGPT / Joyce (or give Claude Code the same text).

````
ROLE FOR YOU (ChatGPT / Joyce)
You are a notation and synthesis aide. Tim will collect suggestions from several AI models (Cursor, Claude Code, ChatGPT, etc.) about Toolbox’s Plan of Repair. Your job in this pass is to NOTATE and preserve Cursor’s position clearly so it can be compared later with the others. Do not rewrite Cursor’s recommendations into a different product. Do not start implementing code. Summarize, label, and keep distinctions sharp.

When you output, use a section titled:
## Cursor’s position (as given)
Then optionally:
## Neutral restatement (no new ideas)
## Open questions this raises for Tim
Do not merge in other models’ ideas in this pass unless Tim pastes them in the same message.

────────────────────────────────
CURSOR’S POSITION — PLAN OF REPAIR
(Copy this whole section as the source of truth for what Cursor said.)

### Product sentence
Plan of Repair is the Customer File’s standalone drawing app for repair / underpinning sketches on a floor plan or contour.
It is NOT a Report Builder template with ink tools glued on.

Same doorway (Customer File → Plan of Repair). Same save home (`record.planOfRepair`, sync component `repair`). Different job: maneuverability on a drawing surface — not layout fidelity to Report Builder.

### What it SHOULD be
- A drawing-first workspace inside an open Customer File
- Feel closer to Microsoft Paint + PowerPoint than to CAD, forms, or report composition
- Big working surface; plan or contour as background; marks/overlays Tim can put down, move, nudge, resize, rotate, copy, stack, undo
- Desktop-first professional sketching for preliminary repair plans
- Local-first; offline-capable with the Customer File; does not require cloud to draw
- Small, reusable stamps for marks Tim actually uses (pier circle, circle-in-square, arrow, note) — not a pier database product
- Print/PDF when needed, but print chrome must not define the editing experience

### What it should NOT be
- A Report Builder–style “drawing template” whose success metric is matching RB chrome
- A second Report Builder (must not write into `reportBuilder`)
- A redesign of Distress, Floor Survey, Customer File, or sync
- CAD / engineering analysis software
- A phone-layout project
- Live collaboration / CRDT / new cloud services for drawing
- A heavy symbol library or pier catalog product
- More permanent Format-panel chrome when the real gap is moving marks on the plan

### Diagnosis — what’s broken / what’s wrong with the current focus
Cursor’s diagnosis (honest, from the current implementation direction):

1. Wrong north star
   Shipping framed POR as “RB-style drawing template” (#188 → #189). That pulled effort toward inherited shell: RB identity bar, format-tool host, title rail, dense Format/Drawing panel, page chrome that reads like report composition. Tim’s need is functionality and maneuverability, not template likeness.

2. Drawing loop friction (the core product failure)
   Tool-arming / selection is fiddly. Tools can stay armed and stack accidental shapes; Format then edits the wrong object. PowerPoint/Paint succeed because select → manipulate → draw next is fluid. Until that loop is fixed, new shape types and more inspector fields won’t feel like a drawing app.

3. Chrome competes with the canvas
   Permanent right-hand form density and RB-like ribbon structure fight “just a drawing page.” Toolbox rule: protect the working surface. POR currently protects the template metaphor instead.

4. Capability gaps that matter for maneuverability (not an exhaustive feature wishlist)
   - Weak pan/zoom ownership of the sheet (Fit/−/+ is not PowerPoint canvas navigation)
   - No reliable one-shot draw / auto-return to Select
   - No arrow-key nudge (and likely weak Shift-constrain habits)
   - No rotate of selected shapes (compass/north exists; shape rotate does not)
   - Limited stamp/mark vocabulary for real repair sketching (legacy pier symbols were migrated to circles — the workflow wasn’t replaced with a good stamp strip)
   - Multi-select / group / align are absent (PowerPoint jump — important, but after the basic loop)
   - Picture insert is stubby
   - Text boxes are thinner than PowerPoint text objects
   - Duplicate-in-place / paste-in-place habits may be weak vs offset paste only

5. What is NOT the main problem
   Missing a thousand shape types is not the main problem.
   Not looking enough like Report Builder is not the problem — looking too much like it is.
   Sync architecture is not the blocker for “feels like a drawing app.”

### How Cursor would fix it (ordered path)
Principle: each slice must prove maneuverability on a real Customer File after merge/promote. No chrome-only passes. No “closer to RB.”

SLICE A — Interaction loop (do first)
- After finishing a shape, return to Select (or true one-shot tools)
- Click empty sheet clears selection; clicking a shape selects without starting a new draw
- Kill the accidental stacked-shape failure mode
User-visible win: “I can place a mark and adjust it without the tool fighting me.”

SLICE B — Maneuver basics
- Arrow-key nudge (Shift = larger step)
- Shift-constrain move/resize where natural
- Rotate selected shape (simple angle or handle)
- Stronger sheet navigation: pan + zoom that feels owned (still keep Fit)
User-visible win: “I can get this pier exactly on the footing.”

SLICE C — Stamp strip (drawing-first, tiny)
- 4–6 fixed stamps Tim actually uses (filled circle, circle-in-square, straight arrow, note/callout, maybe dimension line)
- Click stamp → click plan to place; then Select
- Same overlay model; no pier database; no RB write
User-visible win: “I sketch a preliminary underpinning plan in minutes.”

SLICE D — PowerPoint jumps (only after A–C)
- Multi-select + Group/Ungroup
- Align/distribute
- Ctrl+D duplicate; paste-in-place option
- Better in-place text editing
User-visible win: “I can arrange a cluster of marks like a slide.”

SLICE E — Later / optional
- Guides / light snap
- Dashed lines / arrowhead styles / opacity
- Image paste as first-class sheet objects
- Quieter shell pass: inspector only when something is selected; strip anything that only exists to mimic RB
User-visible win: polish — not the definition of done for “drawing app.”

### Explicit refusals (Cursor)
- Do not merge POR into Report Builder
- Do not rebuild POR as another report template pass
- Do not start with a giant symbol library
- Do not add cloud/collab/CAD scope to “make it better”
- Do not spend the next slice on title-rail visual fidelity

### Success test (how Tim should judge a slice)
On a real Customer File, with a real plan/contour:
- Place marks, move them, nudge them, undo, copy a cluster, adjust without accidental extra shapes
- If that feels like a small drawing app, the slice worked
- If it only looks more like Report Builder, the slice failed even if tests pass

### Reframe table (Cursor)
| Old lens | New lens |
|---|---|
| RB-style drawing template | Standalone drawing app inside Customer File |
| Match RB chrome | Borrow code only when it helps drawing |
| Sheet + rail as product | Maneuverability as product |
| Format panel always on | Tools/inspector when drawing/editing |
| “Looks like a report page” | “I can sketch a repair on this plan” |

### Questions Cursor wants Tim to answer before the next build
1. Confirm product sentence: standalone drawing app inside Customer File — not RB template?
2. Slice A (select/draw loop) first — yes or different first slice?
3. Which 4–6 stamps are the real set for v1?
4. Must shape rotate ship with nudge, or can rotate follow?
5. How much RB chrome can leave POR (title rail density, permanent Format panel) without breaking print needs?
6. Is Print/PDF “good enough” export for now if editing feel is fixed?
7. Any mark types that must look identical to legacy pier symbols from the migrated docs?

END OF CURSOR’S POSITION
────────────────────────────────

INSTRUCTIONS TO YOU AGAIN
1. Notate Cursor’s position under ## Cursor’s position (as given) — preserve the product sentence, should/should-not, diagnosis, slices A–E, refusals, success test, and questions.
2. Add a short ## Neutral restatement with no new recommendations.
3. List ## Conflicts to watch for when other models’ suggestions arrive (e.g. “more template fidelity” vs “maneuverability first”; “big symbol library” vs “tiny stamp strip”; “chrome redesign first” vs “interaction loop first”).
4. Stop. Wait for Tim to paste other models’ suggestions for a later synthesis pass.
````

---

## Claude Code’s position (Nov 8, 2026)

Checked against the code at integration tip `b216940` (`js/plan-of-repair.js`, `js/report-overlay.js`, `js/app.js`, `js/sync.js`), not from memory. Line numbers are from that tip. Input to the council, not a work order.

### Product sentence

Plan of Repair is a **workspace of its own inside the Customer File** — a desk drawing page for sketching repair and underpinning on a level's plan or contour, the way you would in PowerPoint. It stands level with Report Builder and Diagnostics. It is not an add-on to the Customer File and not a Report Builder template.

### Where it should live

- **A workspace, not a button.** Today the only way in is a “Plan of Repair” button in the Customer File's top bar next to Edit customer (`js/app.js:1753`). Everything else about it is already a workspace: its own record (`record.planOfRepair`), its own sync component (`repair`), its own route (`#/file/:id/repair`), pages and print. Only the doorway says “extra”. Tim, Nov 8: “big enough that it needs to be kind of its own page. Not necessarily an add-on.”
- **Inside the Customer File, not beside it.** The plan, the levels, north and sync all come from the job; that is what keeps a repair sketch on the right house.
- **Desk work, same rule as Report Builder and Diagnostics** (AGENTS.md “Device intent”, DECIDED Tim Oct 3): desktop only, no offline requirement, no phone layout. Tim has said he does not expect it in the field. It still saves locally like every component; it just doesn't have to be designed around a crawlspace.
- **Which doorway** — a fifth workspace tile, or paired with Report Builder as the “desk” tools — is a layout call Tim should see rather than have guessed.

### Diagnosis

**A. Defects — broken against what the screen promises. Fix regardless of direction.**

1. **Only the page on screen prints in full** (`js/plan-of-repair.js:1231–1275`). `buildPrintDeck` has an empty loop with a “v1” comment. It prints the active sheet, then every other page as a stand-in with **no background** (the marks float on blank paper) and the literal text “*<title>* — open the page to print its drawing in full.” on the PDF. Page order follows whichever page was open, not the page list. A multi-page Plan of Repair cannot be sent to anyone as it stands. **This is the most serious finding and is not in Cursor's list.**
2. **The rotate grip does nothing.** Every selected shape shows one (`:836`, `css/plan-of-repair.css:175`); no drag mode handles it and shapes have no rotation field. A dead control on the drawing surface.
3. **The picture insert is a stub, and its message is untrue.** It says “Picture insert uses Paste on the sheet for now” (`:1347`), but Ctrl+V only pastes POR's own shape clipboard — there is no handler for images on the system clipboard. The overlay model can already draw an image (`report-overlay.js:12, 123, 228`); nothing creates one.
4. **Draw tools stay armed after each shape.** `endInk` (`:912`) never disarms, so the next click on empty sheet draws again. This is the mechanism behind the accidental stacked shapes. (Clicking an *existing* shape with a tool armed already selects it — `:1096` — keep that.)

**B. Structural — why it feels like a form or an add-on.**

1. **The doorway** says add-on (above).
2. **Formatting is a form in a side rail.** Fill, line colour, weight and X/Y/W/H are fields in the right panel. Paint and PowerPoint put colour, weight and line style on the toolbar as live swatches and keep numbers out of the way.
3. **The vocabulary is short for a repair sketch.** No straight line, no dashed line (proposed vs existing), no arrowhead choice, weight only 1–3, no repair marks beyond the circles and rectangles migrated from the old pier-symbol documents (`:62`).
4. **No keyboard habits.** No arrow-key nudge, no Ctrl+D, no Shift-constrain.
5. **No working on many marks at once.** No multi-select, marquee, align or distribute — and a row of evenly spaced piers is the core underpinning task.
6. **Inherited chrome.** The toolbar host, page list, title rail and zoom came from Report Builder. Some of it earns its place (pages, the rail on the printed sheet, print). Any Report Builder control that does nothing for drawing is chrome fighting the surface.
7. **The background is a live reference.** Each page stores `{ kind, canvasId }` (`:51, :1225`), not a copy. Marks are stored as sheet percentages. If a level's plan is replaced with one of a different shape, or the contour is redrawn with a different extent, the drawing moves under the marks and the sketch is wrong while looking right. A risk, not yet seen.

**C. Questions the code can't answer.** Who authors a POR and whose name is on it — the rail carries a TLS Foundations logo (`:15, :494`) and a SandiaGEO checkbox. And where a finished POR goes: into the report, to a client or engineer as its own PDF, or only kept on file.

### Slices

Small, each shippable alone and demoable on a real Customer File after promote.

| # | Slice | User-visible win | Not included |
|---|-------|------------------|--------------|
| **0** | **Trustworthy** (defects only) | Print/PDF has every page, in page-list order, each with its background, marks and rail; no stand-in text. Dead rotate grip removed until rotation exists. False picture message removed. Regression test that rasterizes a real 3-page PDF. | New tools |
| **1** | **It behaves** | Draw one shape → back to Select; double-click a tool to keep it armed (PowerPoint). Esc in steps: cancel drawing → deselect → disarm. Arrow nudge (Shift = bigger). Ctrl+D. Shift-constrain (square, circle, 0/45/90°). Edge handles as well as corners. Background never selectable. | New shapes, new inspector |
| **2** | **Lines** (and pictures, if Tim wants them) | Straight line, dashed line, arrowheads none/start/end/both, about four visible weights. If photos belong on a POR: Ctrl+V a screenshot or Insert Picture, stored as media on the Customer File so it syncs as bytes. | Crop, filters |
| **3** | **Doorway and toolbar** | POR becomes a workspace entry; top-bar button goes. Colour/weight/dash as toolbar swatches that change the selection (or the next shape). X/Y/W/H and stacking folded under “Size and position”. Unused RB controls removed. DECISIONS.md entry. | Rail redesign |
| **4** | **Many at once** | Marquee, Shift-click, Ctrl+A; move/delete/recolour together; align and distribute. | Group/ungroup |
| **5** | **Stamps** | Tiny stamp strip (below). | Pier database |
| **6** | **Rotate and text** | Rotation stored on the shape, working grip, Shift = 15°, prints. Double-click text to edit in place; size and bold. Only if Tim needs rotated shapes rather than angled lines. | Rich text, fonts |
| **7** | **Canvas navigation** | Ctrl+wheel zoom at the cursor, space-drag pan; Fit stays. | — |

B7 (live background) is a separate small decision whenever Tim answers how plan swaps should behave.

### Stamps

A stamp is a preset that creates **ordinary overlays** at a set size, colour and weight. Once placed it is just shapes: move, recolour, duplicate, delete. No stamp type stored, no special renderer, nothing counted. Starter set: pier (filled circle), proposed pier (outlined, dashed), circle-in-square (Cursor's — likely the legacy pier symbol), beam/footing (thick line), arrow, note box, crack (zig-zag). Later, only if Tim reuses marks job to job: “save selection as stamp” in a device-local list that **never carries media ids** — the lesson of the Report Builder cover default that put one job's aerial on other jobs (#151, `1183e6d`).

### Interaction model

- One tool armed at a time; the cursor shows it (crosshair) as well as the toolbar.
- Draw one shape, back to Select; double-click a tool to draw many.
- Clicking an existing mark always selects it, armed or not.
- Empty sheet: Select deselects; a tool draws. The background is never a target.
- Format lives on the toolbar as swatches — a fixed palette of about six plus “more”, about four weights, solid/dashed, arrowheads — applying to the selection, or to the next shape when nothing is selected.
- Numbers and stacking are secondary, under one fold. Keep the right-click menu, keep it short.

### Response to Cursor

**Agree:**
- Product identity: a drawing app inside the Customer File, not a Report Builder template; never writes `reportBuilder`.
- The draw/select loop is the core product failure, and fixing it comes before new features (Cursor's Slice A = my Slice 1).
- Tiny stamp strip, not a symbol library. Circle-in-square belongs in it.
- Multi-select and align after the basics.
- Every refusal Cursor lists, and the success test: judge it by sketching on a real plan, not by tests passing or by looking like Report Builder.

**Disagree or add:**
1. **Print comes first.** Cursor's diagnosis doesn't mention that a multi-page POR prints only the open page in full and stamps “open the page to print its drawing in full” on the others. That reaches a customer; the drawing-loop friction doesn't. I'd put it before Slice A as Slice 0.
2. **The doorway should change.** Cursor keeps “same doorway (Customer File → Plan of Repair)”. Tim has said it should be its own page, not an add-on. The top-bar button is the one thing that still frames it as an add-on.
3. **Offline.** Cursor lists “offline-capable” as a should. Tim doesn't expect it in the field; under the existing desk-app rule it needs no offline requirement. Saving locally stays — designing around offline doesn't.
4. **Rotate.** Cursor puts shape rotate in Slice B. Rotation touches the stored shape, hit-testing, resize handles and print, so it is the riskiest item on either list. Until it exists the dead grip should come off (Slice 0), and rotate should wait for Tim to say rotated *shapes* are needed, not just lines at an angle.
5. **Dashed lines and pictures are not polish.** Cursor puts them in E. Proposed-vs-existing is usually drawn dashed vs solid, so dashed belongs with the line tool. Pictures depend on Tim's answer; if yes, they are cheap because the model already draws images.
6. **Keep what the printed sheet needs.** Agree the always-on panel should shrink, but the title rail is on the paper, and its status line — “Preliminary — Subject to Structural Engineering” — reads like a liability line. Quieting the editor shouldn't remove it from the print.
7. **Background risk (B7)** isn't on Cursor's list; it should be on someone's.

### Questions for Tim

1. Doorway: a fifth workspace tile, or paired with Report Builder as the “desk” tools?
2. Colour and line style: does red/dashed mean “proposed” and black/solid “existing”, or is it free?
3. Piers: which marks go on every job? Numbered? Typed by hand or counted? (Counting is the line between a stamp and a database.)
4. After drawing a pier, does the tool stay armed (Paint) or return to Select (PowerPoint)?
5. Do photos belong on a POR sheet, or does it stay plan-only?
6. Background: plan, contour, or plan with the contour faint underneath?
7. If a level's plan is replaced after sketching: follow, warn, or start over?
8. Where a finished POR goes: into the report, its own PDF to a client/engineer, or kept on file?
9. Whose name and logo are on it? (TLS Foundations today, plus a SandiaGEO note.)
10. Scale: ever a real distance (“piers at 6 ft o.c.”), or always “not to scale” with a note?
11. Pages: one sheet per level, or detail sheets too (a section through a pier)?
12. Rotation: rotated shapes, or only straight lines at any angle?

### Refusals (Claude Code)

- CAD: true-scale dimensioning, constraints, DXF, layers with visibility.
- A pier database: counts, schedules, materials, quantities from stamps.
- POR inside Report Builder, or writing to `reportBuilder`. Shared code only.
- A layer panel — stacking order plus an unselectable background covers it.
- New cloud services, CRDT, live collaboration.
- A phone or field layout.
- More inspector fields before the toolbar swatches exist.

---

## ChatGPT’s position

*Paste ChatGPT’s audit / suggestions here (dated). After this doc is on the integration tip, ChatGPT / Joyce adds its section (and may use Cursor’s cut-and-paste prompt above for notation).*

---

## Joyce / synthesis notes

*Paste Joyce’s notations and cross-model summaries here as Tim gathers them.*

---

## Comparison scratchpad

Use this table as suggestions arrive. Do not treat filled cells as consensus.

| Topic | Cursor | Claude Code | ChatGPT | Tim lean |
|-------|--------|-------------|---------|----------|
| Product identity (app vs template) | Standalone drawing app in CF | Own workspace inside CF, level with RB/Diagnostics; desk-only | | |
| First slice | A — select/draw loop | 0 — print every page (defect), then select/draw loop | | |
| Stamps vs symbol library | Tiny stamp strip | Tiny stamp strip; plain overlays, nothing counted | | |
| RB chrome | Borrow only if it helps drawing | Same; keep what the printed sheet needs (rail, status line) | | |
| Doorway | Same doorway | Workspace entry; top-bar button goes | | |
| Rotate shapes | Slice B | Remove dead grip now; rotate only if Tim needs it | | |
| Multi-select / group | Slice D (after basics) | Slice 4 (after basics); group later | | |
| CAD / cloud / collab | Refuse | Refuse | | |

---

## Implementation gate

No Plan of Repair code changes from this document until:

1. **Consensus (Tim)** above is filled for product sentence + first slice, and
2. Tim says **go** / **build it** / **do it** on a specific slice.

Discussion and pasted suggestions are not authorization.
