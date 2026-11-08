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

**C. Not settled by the code.** Authorship and branding: the rail carries a TLS Foundations logo (`:15, :494`) and a SandiaGEO checkbox. Destination: nothing in the code says whether a finished POR goes into the report, out as its own PDF, or stays on file.

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

### Refusals (Claude Code)

- CAD: true-scale dimensioning, constraints, DXF, layers with visibility.
- A pier database: counts, schedules, materials, quantities from stamps.
- POR inside Report Builder, or writing to `reportBuilder`. Shared code only.
- A layer panel — stacking order plus an unselectable background covers it.
- New cloud services, CRDT, live collaboration.
- A phone or field layout.
- More inspector fields before the toolbar swatches exist.

---

## ChatGPT’s position (Nov 8, 2026)

Reviewed against integration tip `ffd9017`. The POR drawing source is unchanged since my review at `4351719`. These are product recommendations. Tim owns the consensus.

**Product direction.** POR is a dedicated Toolbox drawing workspace inside the Customer File. A TLS job can start with a plan alone. A Sandia Geo investigation can supply the plan or contour for a distinct TLS preliminary repair drawing. Keep `record.planOfRepair` and the existing `repair` sync component. Keep local save and reopen with locally available plan media. The 11 × 17 landscape title block and preliminary status belong on the finished sheet. Use the current doorway for the first drawing demo and judge a workspace tile separately.

**Where I differ from Cursor and Claude Code.** The active tool should own the gesture. The existing pointer handler checks for an object hit before it starts drawing, so a drag across an existing mark can move the mark. In Select, clicking an object selects it and dragging moves it. In Draw, dragging over ink draws. A one-shot shape returns to Select with the new shape selected. Pencil and an explicitly chosen repeat stamp can stay armed. Escape cancels the current action or returns to Select. A selection click or canceled gesture should consume no Undo step. Keep the selected object's style separate from the defaults for the next mark. See `js/plan-of-repair.js:677`, `:912`, and `:1072`.

**Order I recommend.**

1. **Make the pointer predictable.** Draw across an existing pier, select and move the new mark, change its style, and undo the move in one step. This is the first slice for the drawing-app redesign. Hide the dead rotate grip and the misleading picture action until each works.
2. **Make notes and PDF dependable.** Treat them as separately reviewable defects. The shared text renderer creates an editable box, but POR lacks the edit-to-save handler. A note should survive redraw, local reopen, and print. Claude Code is right that the multi-sheet PDF defect can reach a recipient today. If POR is already being used for multi-sheet delivery, fix that first as a maintenance slice. Print a plan sheet and contour sheet from the second page and verify both backgrounds, marks, notes, and title blocks in page-list order. Report missing backgrounds by sheet. See `js/report-overlay.js:245` and `js/plan-of-repair.js:1231` and `:1331`.
3. **Make a run of piers fast.** Start with one TLS pier mark that places repeatedly and stays editable, plus Duplicate, arrow-key nudge, a straight line or arrow with endpoint handles, and enough zoom and pan to work along a wall. Try it on a real Customer File. Add Shift-click multi-select if moving the run together is a bottleneck. Add a second symbol when a real drawing needs to distinguish two marks. A composite stamp should behave like one object. Skip a stamp database, quantities, and automatic spacing.
4. **Let real drawings drive the rest.** Bring the formatting swatches close to the canvas and keep exact size, position, and stacking available on demand. Collapse panels that have no current job. Add general rotation, image paste, dashed lines, or align/distribute in the order actual sketches need them. A dashed proposed-work line can ship with the straight line if that distinction belongs on the first sheet.

**Background integrity.** Today the sheet resolves the current plan or contour by canvas ID while marks use sheet coordinates. If replacement media has different framing, the marks can point at the wrong place. The intended behavior is to flag a changed source and let the investigator review and accept a replacement. Check whether existing media retention can keep the original background before promising that option. A source change should never silently shift the meaning of an already drawn mark. See `js/plan-of-repair.js:410` and `:1208`.

**First complete demo.** On a real Customer File, open a plan, place and adjust a run of piers, draw a leader or arrow, add a note, reopen the file, and produce the TLS preliminary sheet. Judge the drawing by how little time is spent managing tools and the PDF by whether it matches the saved sheet. Keep the scope within POR and its existing storage. CAD, engineering calculations, capture redesign, and a separate job store are outside this proposal.

---

## Joyce / synthesis notes

# Plan of Repair — Cross-model summary (no consensus)

## 1. Preservation check

- **Cursor:** Full council position and seven questions received. The embedded packet repeats the position and remains in the source.
- **Claude Code:** Full council position, slices 0–7, and refusals received. Standalone question list **NOT PROVIDED YET** in the current source. Open decisions in the prose are carried forward.
- **ChatGPT:** Full council position received. The earlier audit in chat also supplied five named slices and ten questions. Both sequences and the questions are preserved below.
- The council file ends with its implementation gate. No attributed position appears truncated. This comparison records the three positions separately.

## 2. Side-by-side detail (do not shorten into slogans)

### Cursor

- **Identity and SHOULD:** A standalone drawing app inside an open Customer File, keeping the existing doorway and repair save/sync. Desktop, local-first and offline-capable. Large Paint/PowerPoint-like surface with plan or contour, placing, moving, nudging, resizing, rotating, copying, stacking and undoing. Small reusable repair stamps. Print when needed, with drawing driving the editor.
- **Should NOT / refusals:** Report Builder template fidelity or writes to `reportBuilder`; capture, Customer File or sync redesign; CAD, engineering analysis, phone layout, live collaboration, CRDT, new cloud services, large symbol library or pier catalog, more permanent Format chrome, or title-rail fidelity as the next slice.
- **Diagnosis:** Cursor sees template-driven priorities, armed tools and accidental stacked shapes, and permanent inspector/ribbon chrome as sources of friction. It reports limited navigation, one-shot tools, nudge, shape rotation, stamps, multi-select/group/align, image and text editing, and duplicate/paste-in-place. Shift constraints and clipboard limitations were partly tentative.
- **Slices:** A **Interaction loop**; B **Maneuver basics**; C **Stamp strip (tiny)**; D **PowerPoint jumps**; E **Later / optional**. The full per-slice list and all seven questions are in [Cursor’s extract](#cursor-extract).
- **Success / distinctive details:** On a real Customer File, place, move, nudge, undo, and copy a cluster without unintended shapes. Rotation and pan/zoom go in B. The initial 4–6 stamps come before multi-select and Ctrl+D.

### Claude Code

- **Identity and SHOULD:** Desk drawing workspace inside the Customer File, level with Report Builder and Diagnostics. Job supplies plan, level, north and sync. Local save and the existing desk-app rule. Consider a fifth tile or paired desk entry. Keep printed TLS rail and preliminary status. Use visible tool state, swatches, a short context menu and secondary numeric controls.
- **Should NOT / refusals:** Report Builder template or writes; CAD dimensions, constraints, DXF or layers; pier counts, schedules, materials or quantities; layer panel; cloud, CRDT, live collaboration; phone/field layout; more inspector fields before toolbar swatches.
- **Code findings:** Active sheet first in PDF, with stand-ins lacking backgrounds on the other sheets. Dead rotate grip and misleading Picture Paste prompt. Existing marks get picked even with a tool armed, and empty clicks can start another shape. Missing line/dash/arrowhead choices, nudge, Ctrl+D, Shift-constrain, and multi-object editing. Live source reference plus sheet coordinates creates a risk if the plan framing changes. Branding, authorship and output destination are unsettled.
- **Proposals:** Keep picking existing marks with a tool armed. One shot by default, double-click to repeat. Use early nudge, Ctrl+D and Shift constraints. Remove the dead rotate grip now; add stored rotation only if needed. Use ordinary editable stamps. Later save-as-stamp could be device-local and carry no media IDs.
- **Slices:** 0 **Trustworthy**; 1 **It behaves**; 2 **Lines (and pictures, if Tim wants them)**; 3 **Doorway and toolbar**; 4 **Many at once**; 5 **Stamps**; 6 **Rotate and text**; 7 **Canvas navigation**. Full contents, exclusions, and stamp examples are in [Claude Code’s extract](#claude-code-extract).
- **Success / distinctive details:** Print first, including a rasterized three-page PDF check. Demo each slice on a real file. Standalone questions **NOT PROVIDED YET**. The prose leaves doorway, pictures, rotation, source replacement, branding and delivery open.

### ChatGPT

- **Identity and SHOULD:** Dedicated drawing workspace inside the Customer File. TLS can start with a plan alone. Sandia Geo evidence can supply a distinct TLS preliminary drawing. Keep `record.planOfRepair`, `repair`, local save and reopen with local media. Keep the current entry for the first demo. Use a professional 11 × 17 landscape TLS sheet, a compact drawing toolbar and secondary precise controls.
- **Should NOT / refusals:** Report Builder composition or writes to report or survey data; separate TLS job store; CAD, engineering calculations, automatic spacing, quantities, pier database, layer manager or slide master; phone composition, capture redesign or new cloud infrastructure.
- **Code findings:** Existing-object hit preempts drawing; a click can consume an Undo snapshot; duplicated fill controls and style edits can affect tool defaults; editable text lacks a POR save handler; multi-page PDF omits backgrounds and orders the active sheet first. Live source replacement may change what a mark points at. Fixed-offset internal paste, missing nudge/duplicate/multi-select, limited lines and navigation, dead rotation and no image paste. Pencil rebuilds the sheet during movement and eraser deletes whole marks. Actual pointer lag remains unverified.
- **Proposals:** Draw owns its gesture over existing ink. One-shot shapes select the result. Pencil and a deliberate repeat stamp can stay armed. Separate object formatting and next-mark defaults. Place editable text at the click, move it by its frame, and give arrows endpoint handles. Flag a changed background and verify media retention before promising to keep the original.
- **Slices:** Earlier audit: **Make the pointer predictable** → **Make notes real** → **Make the PDF match the sheets** → **Draw a run of piers** → **Add the next capability from a real sheet**. Council: **Make the pointer predictable** → **Make notes and PDF dependable** → **Make a run of piers fast** → **Let real drawings drive the rest**. PDF can precede the redesign if multi-sheet delivery is already in use. Full council text and ten earlier questions are in [ChatGPT’s extract](#chatgpt-extract).
- **Success / distinctive details:** On a real file, place a run of piers, draw a leader or arrow, write a note, reopen, and print. Separately verify a complete plan and contour pair starting from sheet two. One editable repeat stamp first, with duplicate/nudge. Composite stamps act as one object.

## 3. Agreement map

| Point of agreement | Who agrees | Notes (keep nuance) |
|---|---|---|
| Dedicated drawing workspace inside Customer File | Cursor, Claude Code, ChatGPT | Doorway differs. All keep separate repair storage. |
| Core editing before tool-catalog expansion | Cursor, Claude Code, ChatGPT | Does not settle PDF priority or the existing-ink gesture. |
| Small editable preset set | Cursor, Claude Code, ChatGPT | 4–6, seven examples, and one initial pier respectively. |
| Less permanent editor chrome | Cursor, Claude Code, ChatGPT | Claude Code and ChatGPT explicitly retain the printed rail and preliminary status. |
| Incomplete multi-sheet PDF and live-background risk | Claude Code, ChatGPT | PDF is a code finding. Reframing risk was not reported as reproduced on a real file. |
| Dead rotation grip and misleading Picture action | Claude Code, ChatGPT | Both identify the controls separately from the proposed features. |
| Real Customer File demo and no CAD, pier database or new cloud collaboration | Cursor, Claude Code, ChatGPT | Success tests and exact refusals are distinct in the extracts. |

## 4. Conflict map (do not resolve)

| Conflict | Cursor | Claude Code | ChatGPT | Why it matters | Agenda-risk note |
|---|---|---|---|---|---|
| First slice | Interaction loop | Trustworthy print first | Pointer first for redesign; PDF first if used for multi-sheet delivery | Determines first usable improvement | **Agenda risk:** “maneuverability as product” can defer output correctness; “Print comes first” can delay interaction work. |
| Existing ink | Shape click selects; drag-over not specified | Existing mark always selects | Armed Draw owns the drag | Determines whether a stroke can start on ink | Familiar editor conventions may conflict with Tim’s gestures. |
| Repeat | Shape or stamp then Select | Double-click tool to repeat | Pencil and deliberate repeat stamp stay armed | Changes pier placement speed | Additional modes can complicate the pointer. |
| Doorway | Same | Workspace entry; top-bar button goes | Keep for demo, assess tile later | Changes scope of first POR work | **Agenda risk:** “top-bar button goes” expands the drawing work into hub navigation. |
| Offline | Offline drawing | Desk rule, local save, no extra offline requirement | Reopen locally with available media | Defines offline acceptance | **Agenda risk:** broad offline scope could expand into sync work. |
| Text | Better in-place text in D | In-place text in 6 | Fix typed-note persistence early | Affects whether notes can be trusted now | **Agenda risk:** richer editing can expand a plain note fix. |
| Rotation, line style, pictures | Rotate in B; dashes, heads and image paste in E | Line/dash/heads in 2, pictures conditional; rotation in 6 if needed | Hide dead controls, add capabilities when sketches require | Geometry and media work can change slice size | **Agenda risk:** “rotate selected shape” or all arrowhead variants can widen the placement slice. |
| Stamps and multi-select | 4–6 stamps before Group and Ctrl+D | Multi-select/align before stamp strip; grouping later | One pier with Duplicate/nudge, Shift-click if useful | Tests different parts of the pier workflow first | **Agenda risk:** “save selection as stamp” could grow into a library; one stamp may miss a necessary distinction. |
| Pan and zoom | Early B | Last, 7 | With the pier run | Affects placement precision during early demos | No architecture expansion proposed. |

## 5. Detail that must not be lost

- [ ] **Cursor, Claude Code, ChatGPT:** Separate POR document, existing repair sync, no Report Builder write.
- [ ] **Cursor:** A–E order, early rotation/navigation, 4–6 stamps, cluster copy test, and matching legacy marks question.
- [ ] **Claude Code:** 0–7 order, actual three-page PDF verification, Shift constraints, repeat by double-click, workspace entry, Shift = 15° rotation, and all seven stamp examples.
- [ ] **ChatGPT:** Both sequences, conditional PDF-first exception, reliable notes, endpoint handles, separate style defaults, no Undo step for no-op gestures, one repeatable pier.
- [ ] **Claude Code, ChatGPT:** Protect the background and preserve the replacement risk, page order, complete printed rail and preliminary status.
- [ ] **Cursor, Claude Code, ChatGPT:** Preserve disagreement on existing ink, offline requirements, stamp timing and grouping.

## 6. Open questions for Tim only

1. What product sentence and doorway describe POR? (Cursor, Claude Code, ChatGPT)
2. Which work comes first? Is multi-sheet POR already being sent out, and is PDF sufficient as the export? (Cursor, Claude Code, ChatGPT)
3. What cost most time on the last sketch? Do you tend to adjust a new shape or place another, and what should happen over existing ink? (Cursor, Claude Code, ChatGPT)
4. Which pier and other marks are essential? Which must match legacy symbols exactly? (Cursor, Claude Code, ChatGPT)
5. Do you place by eye, along a wall, or at equal spacing? Is shape rotation needed with nudge? (Cursor, Claude Code, ChatGPT)
6. Are leaders essential? How often do screenshots, details or photos go onto a repair sheet? (Claude Code, ChatGPT)
7. Can the same marks sit over plan and contour? What happens if the source changes? (Claude Code, ChatGPT)
8. Which controls should stay visible on a one-sheet job? How much chrome can leave while keeping the print? (Cursor, ChatGPT)
9. Does Print/PDF default to current sheet or ordered set? Is the output a separate PDF, report attachment, or file record? (Claude Code, ChatGPT)
10. When should Sandia Geo attribution appear and how should authorship be shown? (Claude Code, ChatGPT)

## 7. Explicit non-actions for you (ChatGPT)

I did not choose a direction, rewrite POR into a new architecture, discard minority details, or fill gaps with my own roadmap. ChatGPT’s attributed material comes from the existing council entry and earlier audit.

## 8. Appendix — nearly raw extracts

### Cursor extract

#### Cursor’s position (Nov 8, 2026)

##### Product sentence

Plan of Repair is the Customer File’s **standalone drawing app** for repair / underpinning sketches on a floor plan or contour.

It is **not** a Report Builder template with ink tools glued on.

Same doorway (Customer File → Plan of Repair). Same save home (`record.planOfRepair`, sync component `repair`). Different job: **maneuverability on a drawing surface** — not layout fidelity to Report Builder.

##### What it SHOULD be

- A drawing-first workspace inside an open Customer File
- Closer to Microsoft Paint + PowerPoint than to CAD, forms, or report composition
- Big working surface; plan or contour as background; marks Tim can put down, move, nudge, resize, rotate, copy, stack, undo
- Desktop-first professional sketching for preliminary repair plans
- Local-first; offline with the Customer File; no cloud required to draw
- Small reusable stamps for marks Tim actually uses (pier circle, circle-in-square, arrow, note) — not a pier database
- Print/PDF when needed, but print chrome must not define the editing experience

##### What it should NOT be

- An RB-style “drawing template” whose success metric is matching RB chrome
- A second Report Builder (must not write into `reportBuilder`)
- A redesign of Distress, Floor Survey, Customer File, or sync
- CAD / engineering analysis software
- A phone-layout project
- Live collaboration / CRDT / new cloud services for drawing
- A heavy symbol library or pier catalog
- More permanent Format-panel chrome when the real gap is moving marks on the plan

##### What’s broken / wrong with the current focus

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

##### How Cursor would fix it (ordered slices)

Each slice must prove maneuverability on a real Customer File after merge/promote. No chrome-only passes. No “closer to RB.”

| Slice | Name | User-visible win |
|-------|------|------------------|
| **A** | Interaction loop | Place a mark and adjust it without the tool fighting you. After a shape finishes → return to Select (or true one-shot tools). Empty click clears selection; shape click selects without starting a new draw. Kill accidental stacked shapes. |
| **B** | Maneuver basics | Get a pier exactly on the footing. Arrow-key nudge (Shift = larger step); Shift-constrain where natural; rotate selected shape; pan + zoom that feels owned (keep Fit). |
| **C** | Stamp strip (tiny) | Sketch a preliminary underpinning plan in minutes. 4–6 fixed stamps Tim actually uses; click stamp → click plan; then Select. Same overlay model; no pier database; no RB write. |
| **D** | PowerPoint jumps | Arrange a cluster of marks like a slide. Multi-select + Group; align/distribute; Ctrl+D; paste-in-place; better in-place text. Only after A–C. |
| **E** | Later / optional | Guides/snap; dashed lines / arrowheads / opacity; image paste as sheet objects; quieter shell (inspector only when selected). Polish — not the definition of done. |

##### Cursor refusals

- Do not merge POR into Report Builder
- Do not rebuild POR as another report template pass
- Do not start with a giant symbol library
- Do not add cloud/collab/CAD scope to “make it better”
- Do not spend the next slice on title-rail visual fidelity

##### Success test for a slice

On a real Customer File, with a real plan/contour: place marks, move them, nudge them, undo, copy a cluster, adjust without accidental extra shapes. If that feels like a small drawing app, it worked. If it only looks more like Report Builder, it failed even if tests pass.

##### Reframe

| Old lens | New lens |
|----------|----------|
| RB-style drawing template | Standalone drawing app inside Customer File |
| Match RB chrome | Borrow code only when it helps drawing |
| Sheet + rail as product | Maneuverability as product |
| Format panel always on | Tools/inspector when drawing/editing |
| “Looks like a report page” | “I can sketch a repair on this plan” |

##### Questions Cursor wants answered before the next build

1. Confirm product sentence: standalone drawing app inside Customer File — not RB template?
2. Slice A (select/draw loop) first — yes or different first slice?
3. Which 4–6 stamps are the real set for v1?
4. Must shape rotate ship with nudge, or can rotate follow?
5. How much RB chrome can leave POR (title rail density, permanent Format panel) without breaking print needs?
6. Is Print/PDF “good enough” export for now if editing feel is fixed?
7. Any mark types that must look identical to legacy pier symbols from migrated docs?

### Claude Code extract

#### Claude Code’s position (Nov 8, 2026)

Checked against the code at integration tip `b216940` (`js/plan-of-repair.js`, `js/report-overlay.js`, `js/app.js`, `js/sync.js`), not from memory. Line numbers are from that tip. Input to the council, not a work order.

##### Product sentence

Plan of Repair is a **workspace of its own inside the Customer File** — a desk drawing page for sketching repair and underpinning on a level's plan or contour, the way you would in PowerPoint. It stands level with Report Builder and Diagnostics. It is not an add-on to the Customer File and not a Report Builder template.

##### Where it should live

- **A workspace, not a button.** Today the only way in is a “Plan of Repair” button in the Customer File's top bar next to Edit customer (`js/app.js:1753`). Everything else about it is already a workspace: its own record (`record.planOfRepair`), its own sync component (`repair`), its own route (`#/file/:id/repair`), pages and print. Only the doorway says “extra”. Tim, Nov 8: “big enough that it needs to be kind of its own page. Not necessarily an add-on.”
- **Inside the Customer File, not beside it.** The plan, the levels, north and sync all come from the job; that is what keeps a repair sketch on the right house.
- **Desk work, same rule as Report Builder and Diagnostics** (AGENTS.md “Device intent”, DECIDED Tim Oct 3): desktop only, no offline requirement, no phone layout. Tim has said he does not expect it in the field. It still saves locally like every component; it just doesn't have to be designed around a crawlspace.
- **Which doorway** — a fifth workspace tile, or paired with Report Builder as the “desk” tools — is a layout call Tim should see rather than have guessed.

##### Diagnosis

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

**C. Not settled by the code.** Authorship and branding: the rail carries a TLS Foundations logo (`:15, :494`) and a SandiaGEO checkbox. Destination: nothing in the code says whether a finished POR goes into the report, out as its own PDF, or stays on file.

##### Slices

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

##### Stamps

A stamp is a preset that creates **ordinary overlays** at a set size, colour and weight. Once placed it is just shapes: move, recolour, duplicate, delete. No stamp type stored, no special renderer, nothing counted. Starter set: pier (filled circle), proposed pier (outlined, dashed), circle-in-square (Cursor's — likely the legacy pier symbol), beam/footing (thick line), arrow, note box, crack (zig-zag). Later, only if Tim reuses marks job to job: “save selection as stamp” in a device-local list that **never carries media ids** — the lesson of the Report Builder cover default that put one job's aerial on other jobs (#151, `1183e6d`).

##### Interaction model

- One tool armed at a time; the cursor shows it (crosshair) as well as the toolbar.
- Draw one shape, back to Select; double-click a tool to draw many.
- Clicking an existing mark always selects it, armed or not.
- Empty sheet: Select deselects; a tool draws. The background is never a target.
- Format lives on the toolbar as swatches — a fixed palette of about six plus “more”, about four weights, solid/dashed, arrowheads — applying to the selection, or to the next shape when nothing is selected.
- Numbers and stacking are secondary, under one fold. Keep the right-click menu, keep it short.

##### Response to Cursor

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

##### Refusals (Claude Code)

- CAD: true-scale dimensioning, constraints, DXF, layers with visibility.
- A pier database: counts, schedules, materials, quantities from stamps.
- POR inside Report Builder, or writing to `reportBuilder`. Shared code only.
- A layer panel — stacking order plus an unselectable background covers it.
- New cloud services, CRDT, live collaboration.
- A phone or field layout.
- More inspector fields before the toolbar swatches exist.

Standalone questions in the current council source: **NOT PROVIDED YET**.

### ChatGPT extract

#### ChatGPT’s position (Nov 8, 2026)

Reviewed against integration tip `ffd9017`. The POR drawing source is unchanged since my review at `4351719`. These are product recommendations. Tim owns the consensus.

**Product direction.** POR is a dedicated Toolbox drawing workspace inside the Customer File. A TLS job can start with a plan alone. A Sandia Geo investigation can supply the plan or contour for a distinct TLS preliminary repair drawing. Keep `record.planOfRepair` and the existing `repair` sync component. Keep local save and reopen with locally available plan media. The 11 × 17 landscape title block and preliminary status belong on the finished sheet. Use the current doorway for the first drawing demo and judge a workspace tile separately.

**Where I differ from Cursor and Claude Code.** The active tool should own the gesture. The existing pointer handler checks for an object hit before it starts drawing, so a drag across an existing mark can move the mark. In Select, clicking an object selects it and dragging moves it. In Draw, dragging over ink draws. A one-shot shape returns to Select with the new shape selected. Pencil and an explicitly chosen repeat stamp can stay armed. Escape cancels the current action or returns to Select. A selection click or canceled gesture should consume no Undo step. Keep the selected object's style separate from the defaults for the next mark. See `js/plan-of-repair.js:677`, `:912`, and `:1072`.

**Order I recommend.**

1. **Make the pointer predictable.** Draw across an existing pier, select and move the new mark, change its style, and undo the move in one step. This is the first slice for the drawing-app redesign. Hide the dead rotate grip and the misleading picture action until each works.
2. **Make notes and PDF dependable.** Treat them as separately reviewable defects. The shared text renderer creates an editable box, but POR lacks the edit-to-save handler. A note should survive redraw, local reopen, and print. Claude Code is right that the multi-sheet PDF defect can reach a recipient today. If POR is already being used for multi-sheet delivery, fix that first as a maintenance slice. Print a plan sheet and contour sheet from the second page and verify both backgrounds, marks, notes, and title blocks in page-list order. Report missing backgrounds by sheet. See `js/report-overlay.js:245` and `js/plan-of-repair.js:1231` and `:1331`.
3. **Make a run of piers fast.** Start with one TLS pier mark that places repeatedly and stays editable, plus Duplicate, arrow-key nudge, a straight line or arrow with endpoint handles, and enough zoom and pan to work along a wall. Try it on a real Customer File. Add Shift-click multi-select if moving the run together is a bottleneck. Add a second symbol when a real drawing needs to distinguish two marks. A composite stamp should behave like one object. Skip a stamp database, quantities, and automatic spacing.
4. **Let real drawings drive the rest.** Bring the formatting swatches close to the canvas and keep exact size, position, and stacking available on demand. Collapse panels that have no current job. Add general rotation, image paste, dashed lines, or align/distribute in the order actual sketches need them. A dashed proposed-work line can ship with the straight line if that distinction belongs on the first sheet.

**Background integrity.** Today the sheet resolves the current plan or contour by canvas ID while marks use sheet coordinates. If replacement media has different framing, the marks can point at the wrong place. The intended behavior is to flag a changed source and let the investigator review and accept a replacement. Check whether existing media retention can keep the original background before promising that option. A source change should never silently shift the meaning of an already drawn mark. See `js/plan-of-repair.js:410` and `:1208`.

**First complete demo.** On a real Customer File, open a plan, place and adjust a run of piers, draw a leader or arrow, add a note, reopen the file, and produce the TLS preliminary sheet. Judge the drawing by how little time is spent managing tools and the PDF by whether it matches the saved sheet. Keep the scope within POR and its existing storage. CAD, engineering calculations, capture redesign, and a separate job store are outside this proposal.

##### Earlier audit slice order

1. Make the pointer predictable.
2. Make notes real.
3. Make the PDF match the sheets.
4. Draw a run of piers.
5. Add the next capability from a real sheet.

##### Earlier audit refusals

- CAD dimensions, engineering calculations, automatic spacing, repair quantities.
- Pier database, full layer manager, slide master.
- Report Builder merge or separate TLS job store.
- Phone composition, capture redesign, new cloud infrastructure.

##### Earlier audit questions

1. Which action cost the most time on the last preliminary repair sketch?
2. After drawing a rectangle, line, or arrow, would you usually adjust it or draw another of the same kind?
3. What is the one pier symbol you would use most often, and what second symbol must be distinct on paper, if any?
4. Are pier runs placed by eye, lined up along a wall, or equally spaced on the drawing?
5. Do notes need a leader to an exact spot in the first usable version?
6. How often do you paste a screenshot, detail, or photo onto the sheet?
7. Do you switch between plan and contour under the same marks or create separate sheets?
8. If the plan is replaced, should the drawing keep the original or prompt for review of the new plan?
9. Is the usual deliverable one sheet or an ordered set, and which should Print/PDF open by default?
10. Which controls must stay visible while drawing on a typical one-sheet job?

---

## Comparison scratchpad

Use this table as suggestions arrive. Do not treat filled cells as consensus.

| Topic | Cursor | Claude Code | ChatGPT | Tim lean |
|-------|--------|-------------|---------|----------|
| Product identity (app vs template) | Standalone drawing app in CF | Own workspace inside CF, level with RB/Diagnostics; desk-only | Dedicated drawing workspace inside CF | |
| First slice | A — select/draw loop | 0 — print every page (defect), then select/draw loop | Select/draw first for UX; PDF first if already used for multi-sheet delivery | |
| Stamps vs symbol library | Tiny stamp strip | Tiny stamp strip; plain overlays, nothing counted | One editable pier stamp to prove the workflow | |
| RB chrome | Borrow only if it helps drawing | Same; keep what the printed sheet needs (rail, status line) | Canvas first; compact format controls and a printed title block | |
| Doorway | Same doorway | Workspace entry; top-bar button goes | Keep for first demo; assess workspace tile separately | |
| Rotate shapes | Slice B | Remove dead grip now; rotate only if Tim needs it | Hide dead grip; add rotation when a drawing needs it | |
| Multi-select / group | Slice D (after basics) | Slice 4 (after basics); group later | Shift-click when a real run needs it; grouping later | |
| CAD / cloud / collab | Refuse | Refuse | Out of scope | |

---

## Implementation gate

No Plan of Repair code changes from this document until:

1. **Consensus (Tim)** above is filled for product sentence + first slice, and
2. Tim says **go** / **build it** / **do it** on a specific slice.

Discussion and pasted suggestions are not authorization.
