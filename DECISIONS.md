# Toolbox-V3 — Decision Log

Durable decisions already established in `VISION.md`, recorded here for quick reference. This log summarizes; `VISION.md` is the authoritative text if the two ever seem to disagree.

## Product identity

- **Toolbox** is the product name. "V3" is the repository/development-generation name only and must never become product branding.
- The **Customer File** is the central organizing object inside Toolbox — the cabinet metaphor's "file."

## V3 vs. V2

- V3 is a clean rebuild, not a bolt-on to V2. V2 is evidence/reference only, not V3's architecture.
- Preserve proven *behavior*, not inherited *architecture* — what's protected is the field-tested interaction, not the system that produced it.
- Proven field behavior is presumed correct and carries a high burden of proof before it changes.
- The standalone repositories (`field-reporter-pro`, `floorplan-topo-maker`) remain untouched, permanent field fallbacks — not just historical reference.


## Customer File

- **Contact information + plan(s)/canvas(es) = Customer File.**
- The Customer File is one **job container**. Sub-files/components inside it: Customer Information, Plans/Canvases, Distress Survey, Floor Survey, Diagnostics, and Report Builder. All of them obey the same lifecycle. Media belongs to or is referenced by the appropriate component. Diagnostics and Report Builder integration is underway; they are not wholly future work and they are not a separate sync model.
- Plans belong to the Customer File. They are not owned by Distress Survey or Floor Survey.
- There is no fifth “Plan Setup” application and no Plan Setup gatekeeper in the product model.
- Rooms, room names/locations, plan images, orientation/front door, and related shared spatial setup are Customer File data.
- Applications pull what they need from the Customer File and add their own application-specific layers.
- Changing applications does not copy or recreate Customer File plans.
- **KISS and Occam’s razor:** If a change cannot be explained in 2–3 plain sentences, simplify before implementing. Do not add complexity unless it solves a real problem. When two designs protect the data and satisfy the workflow equally well, prefer fewer states, buttons, decisions, assumptions, dependencies, and failure modes. Complexity that is invisible to the investigator still carries a burden of proof if it makes the code fragile.
- **Integration rule: shared plumbing may change; proven capture behavior is protected.**
- A Customer File has a stable internal identity independent of editable contact fields. A new unnamed file may use **TBD** as its temporary human-readable identifier.

---

## Product-area boundaries

- Toolbox should be organized around recognizable workflow/product areas: shared/core foundation, Customer File, Distress Survey, Floor Survey, Diagnostics, and Report Builder.
- Shared functionality and data contracts belong in shared/core areas; workspace-specific behavior, wording, and implementation should remain within the workspace that owns them.
- This segmentation is both a maintainability and AI-context boundary. As the repository grows, implementation agents should always read the complete authority layer, then read the complete relevant product area and the shared interfaces/dependencies it uses. Unrelated workspace implementations should not be consumed or modified unless an actual dependency requires it.
- Organize for human legibility as well as machine efficiency: the product owner should be able to locate and change workspace-specific wording or behavior without searching through an undifferentiated application.
- These boundaries must not be used to duplicate shared data, create internal export/import choreography, or weaken the Customer File as the central organizing object.


## Application data ownership (containers)

Concrete Customer File record ownership for later app plug-in. Architecture is closed; this records the storage contract only.

- **Customer File** owns contact/job fields and shared canvases under transitional `record.planSetup.canvases[]` (stable `canvasId`, name, plan media ref + dimensions, rooms, orientation/front-door). Do not rename `planSetup` merely for cleanliness. Plan bytes stay in the media store by id.
- **Distress** owns `record.distress` (survey state, `startNum`/`nextNum`, `pins[]`). Each observation references a shared canvas via `pin.canvasId` only — no duplicated plan/rooms. Legacy `distress.surfaces` still migrate into Customer File canvases once.
- **Floor Survey** owns `record.floorSurvey` (`schemaVersion`, `byCanvasId`). Layers are keyed by the same Customer File `canvasId` and hold proven Floor Survey fields (boundary/areas, exclusions, transitions, notes, points, etc.) without plan bytes. The integrated UI is the proven floorplan-topo-maker application hosted in Toolbox; ProjectList / plan-upload / level-creation are bypassed because Customer File supplies those.
- Missing app containers on older records are created by tolerant `ensurePlanSetup` initialization (no IndexedDB version bump required for this contract).
- Canvas deletion is not product behavior yet. When added, use orphan detection (`findOrphanedCanvasRefs`) and do not silently destroy field observations.

---

## Distress Survey

- Distress Survey operates on the canvases/levels already established on the Customer File and adds Distress-specific data layers; it does not own or recreate plan/level setup.
- Multiple established canvases/levels may be switched within one continuous Distress Survey.
- Each observation retains its canvas/level identity for downstream use.
- **100% LOCKED:** photograph/pin numbering preserves the exact proven `field-reporter-pro` behavior across all canvases/levels. A pin's displayed number follows the continuous photograph sequence; multiple photographs consume a contiguous range; adding/deleting earlier photographs or deleting a pin recomputes and shifts subsequent numbers to close/open the sequence as the proven standalone does.
- Switching canvases/levels never restarts numbering.
- This numbering behavior is not open to reinterpretation, optimization, simplification, permanent per-pin numbering, or per-canvas numbering.
- Exact treatment of non-level areas such as Exterior, Patio, Roof Parapet, Rear Addition, and other unusual planes is **NOT YET DECIDED**.

---


## Floor Survey

- Floor Survey consumes the same canvases/levels already established on the Customer File; it does not own or recreate them.
- Floor Survey adds its own application-specific data/layers to each applicable established canvas/level.
- Topo Boundary and exclusions are Floor-Survey-specific setup associated with an established canvas/level, not shared Customer File plan data.
- Measurement points, topo data, and Survey Date belong to Floor Survey datasets.
- Survey Date is stored on that Customer File's `floorSurvey`. A second Customer File is a second record, including when both files are for the same property. Legacy bundles that reuse a source project id, floor id, or point id do not alias the two records: import mints new Customer File, canvas, plan, point, and Floor Survey ids. Editing one file's survey date writes only that file.
- Shared room information from the Customer File is available to Floor Survey so room context can be reused rather than entered again. The exact future mechanism for automatic spatial room membership is not yet decided.
- Multiple established levels may each have Floor Survey data. This is not a separate set of Floor-Survey-owned canvases.
- Floor Survey's proven multiple topo areas on the same physical plan remain a separate concept and must not be confused with established canvases/levels.
- The existing "three-dots → Edit" is presentation editing only; it must not silently change underlying measured data.

---

## Distress Edit

- Operates on the live source survey, not a flattened export. Source corrections happen upstream, in Distress itself.

## Cross-workspace data flow

- Normal internal workflow does not use export/import choreography between Toolbox workspaces — each workspace reads shared context from the Customer File and preserves its own authoritative source data.

## Report Builder

- Is PowerPoint-like and flexible — direct page composition, not a rigid generation form. Report Builder holds the book; setup often **starts in the source apps**.
- **Formatting rebuild — visual source of truth (DECIDED Tim, Oct 3, 2026).** Sheets are rebuilt from real finished reports one page type at a time. A screenshot of a real report page that Tim hands over is the visual source of truth for that page type; the Mitchell title page (Jason Mitchell / 59 Lodge Trail) is the source of truth for the title/cover. 1515 Los Nietos stays the structural build baseline and does not override a screenshot just handed over. **Acceptance is visual match judged side by side with the screenshot, not "has the same boxes."** Keep the plumbing (autosave, page rail/order, jump-return, Distress Put on report, Floor Import/place/Lock, evidence rehydrate, Export for AI); replace the formatting. Do not rebuild the removed fake Select/Text/Image/Line/Arrow/Shape toolbar and do not turn Report Builder into a general design app. Seed from the Customer File — never invent client or job data.
- **Does it look and feel like PowerPoint (DECIDED Tim, Oct 3, 2026).** The standing test for Report Builder *behavior*, alongside visual match to a screenshot for *layout*. Where a browser default and PowerPoint disagree, PowerPoint wins. The investigator is not asked to change how a report is written to suit the implementation.
- **Report text is rich text (DECIDED Tim, Oct 3, 2026).** Report-owned wording is stored as paragraphs carrying their own alignment / bullet / indent / direction, each holding runs that carry bold / italic / underline / size / font — which is exactly how a `.pptx` text box already stores the shipped decks (`<a:p>` with `<a:pPr>`, containing `<a:r>` with `<a:rPr sz="1300" b="1">`). Sizes are points. Plain strings are accepted and upgraded, so nothing saved earlier needs migrating. Raw browser HTML is **not** the stored form: the editing surface is contenteditable, but what it produces is read back into this model so a paste never puts foreign markup into the record. A later export back to `.pptx` is then a direct mapping.
- **Formatting toolbar (DECIDED Tim, Oct 3, 2026).** Always across the top of Report Builder, on every page including the title page — Pages left, canvas centre, Toolbox right, formatting above. Font family, font size with grow/shrink, bold, italic, underline, bullets, indent in/out, align left/centre/right, text direction. Deck-measured type sizes remain the **default** for a field; anything set here overrides it for that field and persists. Markdown pasted into a report field is parsed, so narrative returning from an AI collaborator arrives formatted instead of being reapplied by hand.
- **Free placement (DECIDED Tim, Oct 3, 2026).** A text box, circle, or picture may be added anywhere on any sheet to illustrate a point. It does not have to be fixed or registered. Distress Survey's proven `text` / `draw` / `pencil` / `eraser` tooling is the implementation to draw on rather than writing a second one.
- **The review loop (DECIDED Tim, Oct 3, 2026).** Screenshot → match → Tim accepts on a live Customer File after merge, deploy, and hard refresh → next screenshot. **Do not ship "closer."** No page type is done until Tim accepts it on a real Customer File. Code inspection, passing tests, and local screenshots are not acceptance. If the screenshot is unavailable or a visual detail would change the professional page, stop and ask; routine CSS and placement judgment is not that.
- **Title / cover page — Mitchell (DECIDED Tim, Oct 3, 2026).** Left column: "Prepared For:" sage label; client name sage, prominent; email sage, smaller; phone black, bold; "FLOOR LEVEL SURVEY" copper small caps letter-spaced; street huge bold black with no trailing comma; city/state/ZIP gray on one line beneath it (street over city hierarchy); short copper rule; "Survey Date:" sage label, the date, then "Corrected for Floor Differences" in gray. Right column: CONTENTS in a framed box (thin brown/tan border, slight tint) with a copper "CONTENTS" heading; the first line is always the Discussion line "Floor Level Survey Results - Discussion" and is **not** a figure; then figures in slide order as two columns, "Figure N" then the title. Never double-prefix a figure title ("Figure 3 Figure 3 — Pictures") and never use chevrons. Below CONTENTS sits the site aerial/overview image, sourced from a Google Maps link built from the property address plus optional paste/replace; an empty dashed "Site overview photo" hole is not the finished look. Pieces are movable/resizable boxes and Lock stores `reportBuilder.coverLayout`. Title text is editable and persists on the cover page (name, email, phone, street, city, dates, CONTENTS lines). There is no separate Contents sheet.
- **Book order (DECIDED Tim, Oct 3, 2026).** Cover → Discussion → Floor figures → Picture Locations → Pictures (Pictures via Put on report). Everything after Discussion is Figure N by slide order, and reordering renumbers. CONTENTS always lists Discussion first, even when an older saved book stored Discussion last.
- The 1515 Los Nietos report is the initial build baseline (structure, hierarchy, figures, presentation) — a baseline to reproduce first, not a permanent immutable template. Finished professional reports such as Cerros Colorados / Sierra Del Sol (multi-epoch Floor Level Survey) are additional format evidence for typical vs special pages; they do not replace 1515 as the first reproduction target.
- **Source-app staging → drop into template (DECIDED Tim, Oct 2, 2026).** Distress and Floor Survey use **Put on report** / setup actions (with existing jump-return) to drop slides into the Report Builder template for this Customer File. Multi-level Distress uses the app’s real level/canvas model: Picture Locations and Pictures staging run **per level that has work**, with continuous photo numbering across levels; “N photos → slides of 10” is the Pictures pack shape. This supersedes “the report must be fully auto-populated before the investigator sits down” as the mental model. Exact staging UI copy/controls are authorized per build slice.
- **Floor Survey figure pages — Import, place, Lock (DECIDED Tim, Oct 2, 2026).** This supersedes “burn legend + H/L/Δ into forever-fixed Mitchell coordinates on every auto-composed topo page” as the ongoing model. Slice 1’s fixed-slot compose remains shipped history; new Floor Survey report work follows this rule.
  1. Page opens with **Customer File / report chrome only** (figure # / title, date, corrected line, name/address, north / Front Door, brand, etc.) in typical places.
  2. **Import** (report page and/or Floor Survey add-to-report) brings in topo view (plan + contours + readings as one unit), contour legend, and H/L/Δ pill — not a field screenshot paste.
  3. Import uses **typical default positions**; investigator may move/resize those boxes (readable bounds), then **Lock layout**.
  4. Locked layout + view framing **inherits** on following Floor Survey pages so level-on-level flip charts stay registered. Unlock only when changing the book layout.
  5. Cover, discussion slots, TOC from finished slide order, and other stable pieces stay template-friendly. Fuzzy PDF/JPEG paste of topo is not the path.
- **Build guardrails:** do not separate plan from its contours/readings; do not require a blank scatter of boxes after Import; do not turn Distress into a second permanent report-caption editor; do not build CRDT/live multi-user layout editing.
- **Book shape:** cover + identity; Discussion empty slot; Distress Picture Locations / Pictures (from staging, multi-level aware); Floor Survey slides (chrome → Import → Lock); investigator-owned specials. Counts need not be known ahead of time.
- **Special cases stay investigator-owned:** epoch divider banners, side-by-side epoch pages, narrative discussion, and which views enter the book. Automation must not force one book shape for every job.
- Field Topo may keep movable working chrome for capture. Those positions do not drive report layout. Deliverable Floor Survey presentation is Import → place/resize → Lock in Report Builder.
- Will support basic drawing/annotation on report content; the exact toolbar is not yet decided. The early Select/Text/Image/Line/Arrow/Shape “skeleton” ribbon was **removed** (Tim, Oct 2, 2026) — it was not real composition and must not return as placeholder chrome.
- Follows "protect the canvas" — compact pills and collapsible tools, not a permanent desktop-style ribbon.
- **Plumbing vs formatting (DECIDED Tim, Oct 2, 2026):** Keep Report Builder plumbing (autosave on `reportBuilder`, page rail/order, jump-return, Distress Put-on-report, Floor Import/Lock layout data, evidence rehydrate from source apps, Export for AI). Scrap/rebuild sheet formatting against real report screenshots rather than guessing a PowerPoint ribbon. Next page layouts are authorized by screenshot walkthrough (Chalmers / Mitchell / 1515 / similar), one page type at a time.
- Comes before Diagnostics in the **application** build order: an operational Toolbox (Customer File → Distress/Floor → Report Builder) should be possible before Diagnostics is required.
- Report Builder and Diagnostics are not wholly future work. Report Builder evidence, the 11×17 slide sequence, Pictures pages, Pen Log, Floor Import/Lock, and the Mitchell title page are on `main`; a Diagnostics entry for Floor Survey 3D is in. They obey the same Customer File lifecycle. Sync work must not redesign them or field capture. Pull requests #68, #69, and #70 were **closed without merging** and do not describe current state; title-page work is #106 / #107.
- **Mark report complete + completion date** is on the product list as a future closeout affordance. It is not authorized as part of the first topo figure-page implementation slice.
- **First implementation slice — AUTHORIZED (Tim, Oct 1, 2026).** Build and ship only this:
  1. Cover with Customer File identity + TOC.
  2. Discussion / Damage Summary as an editable empty slot (no invented narrative).
  3. One Floor Level topo figure page per boundary / epoch: Combined / All when useful, then each named boundary (e.g. Main, Kitchen / Living). Mitchell and 1515 Los Nietos are the proof targets.
  4. Fixed chrome on every topo figure page, Mitchell / 1515 visual slots: figure title/number and survey date top-left; residence / address / Front Door (with north cue) top-right; contour legend + H/L/Δ overlaid on the registered drawing frame; relative-readings box and brand strip at the bottom. Cover uses Prepared For + FLOOR LEVEL SURVEY identity with a CONTENTS box. Same slot positions on every related topo page.
  5. Recovery PDF may fall back when compose is unavailable; cut-and-paste field Topo screenshots are not the path.
  **Out of this slice:** Pen Log / drawing toolbar, picture pages polish, epoch divider banners, side-by-side epoch pages, mark-complete + date, Report Builder startup questionnaire, full PowerPoint-like flexibility beyond adapting these assembled pages.
- **Report edit ownership (decided Tim, Oct 1, 2026; staging clarified Oct 2, 2026):** Pin/placement moves are fixed in Distress Survey. Reading/measurement changes are fixed in Floor Survey. Source apps may **stage and drop** slides into the report (seeded from source text). **Deliverable wording after drop-in is edited in Report Builder** — captions, descriptions, discussion, labels under photos, and similar. Report text edits do **not** write back into Distress or Floor Survey. Jump links are for source fixes and return to the report, not a second forever-home for report prose.
- **Second implementation slice — AUTHORIZED (Tim, Oct 1, 2026).** Build and ship:
  1. **Autosave Report Builder to the Customer File** (`record.reportBuilder`) so page order, assembled structure, and report wording persist locally and sync as the report component. Do not store photo/plan binary evidence inside the report document — rehydrate those from Distress / Floor Survey on open. Autosave is immediate/offline-capable like other Customer File work.
  2. **Came-from-Report-Builder jump return** — **Back to Report Builder** sits in the same top bar as `‹ Customer File`, only when the investigator arrived from Report Builder (session origin). Return restores the report page they left. Not permanent capture chrome; not desktop detection.
  3. **Pictures pages with descriptions** — Mitchell-style fixed grid with real Distress photos; **Photo NN** + caption/description under each image; captions editable on the report sheet (report-owned text). Seed captions from Distress observation text. Picture Locations (plan + table) is **not** in this slice.
  4. **Reconcile on open** — when Distress/Floor gains new pins/photos/figures (e.g. Quick Capture pulled into Distress), reopen compares saved report pages to current source: keep existing report pages and wording; add pages/slots for new source items. Do not silently wipe investigator report text.
  **Out of that slice:** Picture Locations page, Pen Log / drawing toolbar, epoch divider banners, side-by-side epoch pages, mark-complete + date, Report Builder startup questionnaire.
- **Report Builder Picture Locations / Pen Log (authorized Tim, Oct 1, 2026):** Finish the native Pen Log page that was drafted in PR #91 and integrate it with current Report Builder on main. One page per Distress level with pins: plan, numbered pins, Photo / # / Location / Notes schedule, title “Figure N” + “Picture/Damage Locations”. Report notes persist on the report component (`reportBuilder.penLog.notes` and page `reportText.notes`) and do not write back to Distress. Drawing toolbar remains out of scope.
- **Third implementation slice — AUTHORIZED (Tim, Oct 2, 2026).** Build and ship the decided staging / Floor Survey model:
  1. **Floor Survey pages:** Customer File chrome first; **Import** loads topo view + contour legend + H/L/Δ as separate boxes at typical defaults; move/resize (readable bounds); **Lock layout** persists on `reportBuilder.floorLayout` and inherits on other Floor Survey pages. Unlock to edit again. No field pinch-zoom. Plan+contours+readings stay one topo unit.
  2. **Distress Put on report (Pictures):** From Distress (host), stage photographs onto Pictures slides (10 per page, multi-level aware via existing numbering) into `reportBuilder`, then open Report Builder (jump-return session). Deliverable caption edits stay on the report pages.
  **Out of this slice:** Full field Topo tool parity in Report Builder; Picture Locations staging button (Pen Log pages may already exist from prior auth); free-form distortion; CRDT/live collaboration.
- **Formatting rebuild — AUTHORIZED (Tim, Oct 2, 2026).** Keep plumbing; remove fake composition toolbar; rebuild sheet layouts from real report screenshots via talk-through placement. Do not reintroduce placeholder drawing tools. Page-type visual rebuilds are authorized when Tim supplies the screenshot for that page.
- **Title page — AUTHORIZED (Tim, Oct 3, 2026).** Mitchell title layout: filled movable boxes (Prepared For, identity/address, date/corrected, CONTENTS, site overview); Google Maps link from address; paste/replace overview image; Lock on `reportBuilder.coverLayout`. No separate Contents sheet. Assemble order: Cover → Discussion → Floor figures → Picture Locations; Pictures via Put on report. Figure numbers for every slide after Discussion follow page order.

## Diagnostics

- Integration has started. Exact analytical tools/methods are not yet decided. Not a mandatory gate for every report.

## AI collaboration

- Will be model-agnostic — no permanent dependency on a single AI vendor. This is future architecture, not an early milestone.

## Open product questions / possibilities — NOT YET DECIDED

These notes preserve active product possibilities so they are not lost. They are **not implementation authorization or requirements**. Do not implement them unless the product owner explicitly decides and authorizes the relevant scope.

- **Quick Capture / Customer File photos:** Quick Capture may remain conveniently accessible from Distress Survey while the resulting photographs are stored with the Customer File. A possible workflow is to choose a subject such as Interior, Exterior, Grading & Drainage, or Other, with the resulting photo folder named from the subject plus the date the photographs were taken. Exact workflow, storage shape, and UI are not yet decided.
- **Report Builder startup questionnaire:** Automatic assembly from Customer File evidence and the fixed figure-page composition rule above are decided. Whether any remaining gateway questions appear only for sections Toolbox cannot infer, and the exact first-open UX, are not yet decided.
- **Report Builder first implementation slice:** Authorized Oct 1, 2026 — see the Report Builder section above. File Cabinet sync work must not redesign this slice.
- **AI-assisted reporting:** Future model-agnostic AI connectors may use structured Customer File and application information to help organize evidence, summarize material, ask targeted questions where professional context is missing, and assist with technical report drafting. Exact interaction and architecture are not yet decided.
- **File Explorer shows the pictures now (DECIDED and BUILT Tim, Oct 10, 2026).** The sections were right — Distress Survey, Quick Capture, Other photos — but every photograph was an identical text row: "Distress Survey photograph · Image · 115 KB", with Open and Download. Opening one dropped a preview at the foot of the page, so looking at the second meant scrolling down, back up, and down again. Tim: "These pictures should just be in a folder where you can see a thumbnail of all of them and then click on the pictures to make them bigger, not organized one at a time."
  - Anything the Cabinet stored as an image is now a tile on a contact sheet inside its section — photographs, floor plans, diagnostics figures. One rule, so nothing has to be remembered when a new kind of picture is added.
  - Tiles load as they are scrolled to, and each is drawn down to a small canvas with the original released at once: a hundred full-size photographs held open is how a phone runs out of memory.
  - Tapping one fills the screen, with arrows over the picture, Escape and the arrow keys, and Download for that file.
  - **Download all** per section, as one ZIP. Tim: "That gives us an opportunity, if I want to download a file I can download all the pictures or not." An unreadable object is skipped and counted rather than losing the rest.
  - **A caption says what makes a picture different from its neighbours.** "porch.jpg" earns its place; "Distress Survey photograph" under all eight does not, and the heading above already said it, so a caption identical across a whole sheet is dropped. One picture on its own always keeps its name.
  - **A downloaded Quick Capture is named for the day it was taken (DECIDED Tim, Oct 10, 2026).** Tim: "I want it as the date they were taken, not the date that I downloaded them to the computer." The shutter time is already stored on each capture; it was simply never used for a name. The ZIP is the group plus that day (`quick-capture-2026-03-02.zip`), or the span when a set covers more than one day so a folder never claims a date half its contents do not share. Each picture inside carries the time too (`2026-03-02_174512.jpg`).
  - **The capture time is read only when a download asks for it.** It lives in the distress component rather than on the stored object, and a missing object on the read-only explore route falls back to the working sync API — which is not something a back door should do on a page view. A download is a request the investigator made, so the join belongs there.
  - **A run of Quick Captures is a named set (DECIDED Tim, Oct 10, 2026).** Tim: "If I take a bunch of quick captures and I press Done, I should be able to at the start of the quick capture name the file that those go in; then if I do another quick capture later I can start another file." So the name is asked for at the start of a run and written onto every photograph taken in it. A later run starts a new set.
  - **It replaces a step rather than adding one.** Quick Capture already asked "Start Quick Capture?" before opening the camera; that question is now the name. Cancel still means no session. An empty name is not a reason to lose photographs, so a run left unnamed is filed under the day.
  - Downloads follow: one named set is the name of the ZIP (`exterior-2026-03-02.zip`), and each set is a folder inside when a download spans several. This answers the subject half of the Oct 4 note — the subject is typed when the run starts rather than picked from a list, because the investigator knows what they are about to photograph and a list would only be wrong in the field.
  - Still open: distress photographs carry no per-photo name from the server.
- **File Explorer is not usable as a way to find photographs (raised Tim, Oct 4, 2026).** "The way that they are shown in File Explorer is unusable. All of the Distress pictures need to be in a folder... right now we have all the Quick Capture pictures and it does nothing with them. Those need to live in a file where I can open them up and look at them... right now those pictures are useless unless we open the app, and there really is zero way to get back to the Quick Capture photos." Two separate problems: Distress photographs are not grouped into anything a person can browse, and Quick Capture photographs are a dead end — taken, stored, and then reachable only by reopening the application that took them. Not scoped or authorized; the folder shape overlaps the Quick Capture note above and the two should be settled together.
- **The topo control rail is cluttered and should be rethought for both screens (raised Tim, Oct 6, 2026).** Tim: "The rail is just very cluttered and I don't like it, it's not usable... I didn't like the one of the pills in Floor Survey anyway, so whatever we do we are probably doing it to both screens, Floor Survey and Report Builder." One rethink, applied to the field app and the report slide, not two separate layouts. An idea he floated: the colour contour controls, including reverse, could be a floating pill the investigator moves around the canvas rather than a panel pinned to the rail. Not scoped or authorized. Whatever is settled here is to be recorded before it is built, and the Report Builder side of it counts as a named capture-app-adjacent change under the Oct 4 rule.
- **A title block on the Floor Survey slide (raised Tim, Oct 8, 2026 — idea, not decided).** From the finished presentations: all four corners carry something. Upper left is Figure X and its description. Lower left is the Sandia Geo logo. One corner holds the north arrow; another holds the address, the homeowner's name, the date the survey was done and "corrected for flooring". Tim wants that last group gathered into one thing he calls the **title block** — address, homeowner or last name, residence, and the High/Low, "just like it kinda is now". It would use the blue and red pill rather than the yellow dot, which he thinks is the better call anyway.
  - **A button that moves it.** The title block sits in the lower right or the upper left depending on how the plan lies on the page, and one button click swaps it between them. The north arrow should move the same way.
  - **What stays put.** The logo is almost always lower left. Figure X and its description is always in the same place.
  - **What the finished deck actually does** (Mitchell Residence, 59 Lodge Trail — measured from the file, 17 x 11 in): upper left, "Figure N / Floor Level Survey — <level>" with "Survey Date" and "Corrected for Floor Differences" beneath it. Upper right, right-aligned, "Mitchell Residence / 59 Lodge Trail / Santa Fe, NM 87506", with the compass rose below it. Lower left, a Google aerial view of the house and the Sandia Geo logo under it. Lower right, a thin-ruled box holding the High and Low relative readings against yellow H and L keys, with a second ruled band under it for the Total Relative Elevation Difference. The per-boundary H/L/delta pills sit on the plan itself, next to each surface's colour legend.
  - So the title block is that lower-right box, carrying the identity lines that are presently spread across the other two corners, with the yellow keys replaced by the red and blue pills.
  - **Settled (Tim, Oct 10, 2026): the Google view belongs on the Floor Survey page too, and fills itself in.** Put it on the cover once and it appears on the Floor Survey pages automatically; if it is wrong on a given page, delete it there. Tim: "Once you put it in on the cover page it should automatically go in there, and then if it's not right you just delete it." This answers the Oct 8 question above ("I don't know if you need to do that anymore") the other way. Not yet built.
- **Features with an invisible prerequisite, and who other than Tim can find them (raised Tim, Oct 10, 2026).** On the contour layer: "What I'm afraid of is we are adding functionality which is tremendous — I really really really like it — but it almost feels like now it's inside information and only I'm gonna know how to use it. So we need to think through some of that, and maybe it's just when we are done."
  - The gap is not the control. The layers pill sits next to the level pill where it can be seen. What is invisible is the **prerequisite**: nothing in Distress says a contour is possible, and nothing in Floor Survey says one is wanted. The path runs between two applications and is not visible from either end, so Lee would never find it.
  - Worth running the UX pass as a specific question rather than a polish round: **for each thing built, can someone who did not build it find the path?** That is answerable per feature, and it catches anything else with the same shape.
  - Tim's own framing is that this may be work for when the building is done. Not scoped, not authorized.
- **The contour on a Report Builder figure (shape proposed by Tim, Oct 10, 2026, not authorized).** A choice on the figure rail between Distress Survey pins and Distress Survey pins on the black-and-white contour — two named choices, matching the two states settled for the field. See the contour layer section above for what still needs deciding first.
- **Distress visual/menu cleanup:** Possible changes include removing the unused Clear all drawings command, reconsidering how Quick Capture is presented, and evaluating visual/chrome consistency with the other Toolbox applications. None of these changes is decided.

---

## Cloud, offline, sync, and access

- **Local-first:** local IndexedDB remains the working storage apps use. A Customer File actively being worked on has one editing/working authority: the active local device.
- **File Cabinet:** Cloudflare (Worker + private R2) is the shared, transfer, and filed location, and the device-loss mirror of the active working Customer File. It is not the live editing authority and not a second concurrent editor. Devices do **not** keep complete synchronized copies of the entire Cabinet. Cloud-only files are normal. Local-only drafts are normal until placed in the Cabinet. A device may keep a complete local safety copy of a file it already holds.
- **Quiet mirror (decided Sept 24, 2026):** when online, the active working Customer File is quietly mirrored to the File Cabinet for device-loss protection. This is not later polish. It does not replace Sync Now.
- **Autosave** = ongoing local work; immediate and offline-capable. It is not the field checkpoint and it is not cloud sync.
- **Field Save checkpoint (decided Sept 24, 2026):** a deliberate Save in integrated Floor Survey or Distress Survey creates or replaces **one** protected field checkpoint for that survey. Repeated Save replaces the prior checkpoint; do not create Save 1/2/3 histories. Write the replacement successfully before retiring the previous checkpoint. The checkpoint holds the structured information needed to reconstruct that survey, plus its recovery visual/PDF as applicable. Existing photos, plans, and other media are referenced, not duplicated. The checkpoint syncs to Cloudflare / File Explorer as recovery material. Check Out must not automatically download or materialize it as the normal working survey. Floor Survey’s recovery PDF is the existing checkpoint. Distress follows the same principle without a change to protected capture flow or to `field-reporter-pro`.
- **Sync Now** = the manual confidence/safety action after poor signal. It updates cloud copies of this device’s **local working** Customer Files and required media. It must say **“Sync complete.”** when changes upload and **“Everything is already synced.”** when nothing changed. A failure must not be worded as success. Sync success is not local inventory == cloud inventory. Sync must **not** auto-materialize every remote-only Customer File.
- **Check Out** transfers exclusive editing authority to the receiving device (user + device). The checkout foundation is in the repository. Other devices may retain complete local safety copies; after they learn the file is checked out elsewhere those copies are gray/read-only and cannot mutate or sync over it. **File Explorer** is the read-only server back door, not a second Customer File editor.
- **Check In** on the editing device syncs, verifies the Cabinet copy, and releases exclusive authority. It never cloud-deletes. The foundation in the repository also removes that device’s own working copy; that removal is not Trash and does not delete another device’s safety copy. Sync while checked out backs up without releasing.
- **Later local-copy cleanup (decided, not current work):** after another device’s work is released and the File Cabinet copy is verified complete, the older local device may offer Remove From This Device / Keep Local Copy / Archive as Revision. Do not implement it in ordinary work. Remove From This Device is local-only and is not Trash.
- **Component-level synchronization:** Customer Information, Plans/Canvases, Distress, Floor Survey, Diagnostics, and Report Builder sync independently and obey the same lifecycle. Component LWW remains defensive/recovery plumbing. Exclusive checkout prevents normal multi-writer editing.
- Plans and Distress photos must synchronize as **actual media**, not references alone.
- After a Customer File is local on a device, that device must open and work on it offline without cloud dependency. A gray read-only copy may still be viewed offline; it must not mutate or sync over a checkout held elsewhere.
- Authentication may be required to Sync Now; it must **not** be required to open or use already-local Customer Files offline.
- **Starting access:** Cloudflare Access for Tim and Lee (small authorized set). No SaaS tenancy, roles, invitations, billing, or per-file ACL product.
- **Minimum cloud infrastructure:** Cloudflare Worker + private R2 unless implementation proves a concrete need for something else. Do not add D1, KV, Durable Objects, Queues, Firebase, Supabase, or similar without that proof.
- Preserve recoverable Customer File Trash and durable permanent-delete tombstones so stale copies cannot resurrect deleted files.
- **Delete follows the cabinet copy, not the checkout flag.** `checkedOutFromCabinet` records that this device checked the file out. It does not mean a file without that flag is local-only. If Delete finds a live File Cabinet index, it moves that server copy to File Cabinet Trash and removes the local working copy only after Trash is confirmed. A file is deleted on this device only after the cabinet positively reports that no index exists. If the cabinet cannot be reached, the local file stays and the delete remains pending, including a local file saved before any mirror marker existed. A checkout held on another device is refused. Permanent delete requires the server index to already be in File Cabinet Trash. A live index is refused before any tombstone or media write. Retry of a purge that already wrote its tombstone may finish.
- Do not redesign Distress capture, Floor Survey capture, or Customer File; do not build a Control Panel as part of this work.
- iPhone, iPad, installed PWA, and desktop browser are equal Toolbox devices.
- Continuous live deployment remains required during development so the product owner can inspect real progress on those devices.

### Superseded

- Full-cabinet convergence across devices after Sync Now (“Device B Sync receives Device A’s entire library automatically”) is **superseded** by the File Cabinet + selective local + exclusive checkout model.
- “Manual Sync Now is v1; quiet automatic sync is later polish only after manual sync is trusted” is **superseded**. Quiet mirroring of the active working Customer File is decided. Sync Now remains the manual confidence action and must use the truthful wording above.
- Reading “Cloudflare is the authoritative File Cabinet” as “the cloud is the live editing authority” is **superseded**. Editing authority is the active local device. The File Cabinet is the shared, transfer, and filed location and the device-loss mirror.

## Delivery to the client

- **The emailed deliverable is the PDF, not a link (DECIDED Tim, Oct 3, 2026).** `VISION.md` §16 already makes the PDF the durable closeout record; this settles how it reaches the client. A PDF is fixed at the moment it was sent, which matters when the question later becomes what the report said when the client relied on it — a link can show different content afterwards and introduces version ambiguity into exactly the document that must not have any. Clients also forward reports to contractors, engineers, insurers and attorneys; a PDF survives that, and a link behind Cloudflare Access (scoped to Tim and Lee) does not. Opening that up would mean share links, public access and expiry — the start of the SaaS product `VISION.md` §17 says Toolbox is not.
- A link may later earn its place for something a PDF carries badly, such as a very large photo set, or for Tim's own access from the field. That is an internal convenience. The PDF must never depend on a link working.
- **Toolbox does not send the email.** It produces the PDF and the investigator attaches it in their own mail client. Sending would mean a mail service, deliverability and bounce handling — a new external dependency for something already solved, and it keeps the sent record in the correspondence history where it belongs.

## Report Builder device intent and offline

- **Report Builder and Diagnostics are desktop/large-screen workspaces (DECIDED Tim, Oct 3, 2026).** "It is the intention for Report Builder to never really work outside of a desktop, or a large screen." Composing a 17 x 11 in deliverable means placing boxes precisely with a pointer across a wide canvas plus a tool rail; a phone cannot show the page and the rail at once without becoming a different product. Field capture stays mobile-first — this changes nothing about Floor Survey, Distress Survey or Customer File setup.
- **Report Builder and Diagnostics do not need offline capability (DECIDED Tim, Oct 3, 2026).** Report composition happens at a desk after the site visit, not in a crawlspace. Offline remains a core requirement everywhere capture happens.
- Consequence for implementers: do not add phone layouts, touch-target compromises, or offline fallbacks to Report Builder, and do not let any of those constrain its design.

## Floor Survey slides in Report Builder

- **The slide hosts the real Floor Survey topo view (DECIDED Tim, Oct 3, 2026).** Report Builder does not compose its own picture of a topo. It mounts the same component and the same canvas the investigator draws on, so there is one renderer and nothing to drift. "The code is right there."
- **The camera is the crop.** Scroll to zoom, drag to pan; the view set is the frame. No extent calculation, no margin setting, no crop tool. The camera is stored against fit rather than in pixels so the same framing holds from the screen to a 17 x 11 in page.
- **One camera for the whole book.** Every Floor Survey slide opens with it, so clicking through Combined, Main Level, Kitchen and Garage is a flip chart: the plan does not move. Because the plan raster has fixed image coordinates, data bleeding outside the walls cannot shift it.
- **Chrome is per slide and free to move.** The colour scale, the H/L/delta pill and the High and Low markers start from a shared default and are then nudged per page, because the high point sits somewhere different on each boundary. Per-box locking is deliberately not built yet; judge it after using the flip chart.
- **The page is laid out from the four shipped decks, measured** — not from invented numbers. Every block is a freely movable, resizable, removable box, the way PowerPoint treats them. The topo is the focus of the page and is sized accordingly.
- The decks carry **no north arrow or "front door" block** on a Floor Survey page; Toolbox had invented one.

## Capture app changes

- **The capture apps are no longer closed to change; each change is named and approved (DECIDED Tim, Oct 4, 2026).** `floor-survey/AGENTS.md` previously said "Do not modify this repository as part of Toolbox-V3 development." In Tim's words: "We said don't touch it because I didn't want the capture apps to change the functionality, but now we have to change the functionality because the ecosystem is evolving — so some changes are acceptable because that is the way they need to progress in order to get what we want."
- **What was being protected is proven field behavior, not the files.** The blanket ban was too blunt once Report Builder began hosting Floor Survey's own components, and the root rule ("integrated Toolbox copies may evolve") was too loose to be a gate. The replacement sits between them.
- **The rule.** Before changing anything an investigator would notice in a capture app — a gesture, a default, a visible size, a control's placement, how data is written — name the specific change and get approval. Record approved changes here. Plumbing that leaves field behavior identical does not need approval: an optional prop defaulting to current behavior, a shared function extracted, an existing component hosted somewhere new. "Identical" is a claim; show the diff.
- **Scope.** `floor-survey/` and `distress-survey/` inside Toolbox-V3 are the integrated copies and are in scope. The standalone repositories `field-reporter-pro` and `floorplan-topo-maker` are **not** — that protection was not lifted. Both integrated directories now carry an `AGENTS.md` stating this rule.

## Report Builder drawing tools

- **Report Builder adopts Distress Survey's drawing tools (DECIDED Tim, Oct 4, 2026).** Same tool set, same order, same grouping — pencil, rectangle, circle, arrow, text, eraser, then three weights, then five colours — laid out horizontally in Report Builder's formatting bar, with Distress's behavior: pick a tool, then draw where you point. Report Builder's current annotations insert a preset box at a fixed spot and are then dragged, which is a reimplementation of code that already existed and works.
- **This supersedes two earlier lines.** "Do not reintroduce placeholder drawing tools" (Oct 2, 2026) removed a fake Select/Text/Image/Line/Arrow/Shape skeleton ribbon that did nothing. That ban stands for placeholder chrome; these are the proven tools themselves, which is the opposite case. "Compact pills and collapsible tools, not a permanent desktop-style ribbon" is superseded for Report Builder by the Oct 3, 2026 decision that Report Builder is a desktop/large-screen workspace — the reasoning behind compact pills was mobile-first, and Tim's instruction was "horizontal on the rail that has enough space for all of that."
- **Match the output, not the buttons.** The five colours (`#c14a2b` `#111111` `#1d4ed8` `#16a34a` `#ea7317`) and the three weights must be identical to Distress, because a shape drawn on a report slide can sit on the page next to a photo circled in the field. If the reds differ, the report looks like two people made it. The icons are redrawn as SVGs in Report Builder's existing convention (24x24, 17px, `stroke-width: 1.7`) rather than pasting Distress's emoji glyphs: same family of apps, different screen.
- **Controls that change the document speak PowerPoint; controls that put ink on a drawing speak Distress.** That is the dividing line for this toolbar and for the ones after it.
- **Callout** (text with a leader line) and **highlight** (translucent shading over an area) are wanted and are a later pass. **Front/back ordering** was pinned, then accepted as a likely consequence of highlight — a highlight over a circle washes it out, under it does not.

## Layers and levels

- **Three words, and the hierarchy they describe (DECIDED Tim, Oct 10, 2026).** Tim: "In this case levels can have another layer, right — KISS hierarchy." Customer File → levels → layers.
  - A **level** is one storey of the building — the basement, the main floor, the second story. Each has its own plan image. In code today this is a Plan Setup *canvas*; it is what Distress's level pill switches between, what Floor Survey keys its readings to, and what the Customer File's "+ Add another level" makes.
  - A **layer** is something that sits on a level. The floor plan picture is the first layer. A black-and-white contour of that level is a second. An application's own data on that level — Floor Survey's readings, Distress's pins — is also a layer in the Vision's sense.
  - A **boundary** is a surface within one level — a sunken living room or a step-down addition on the same plan. In code this is a Floor Survey `TopoArea`, and the step between two of them is a *transition*, carrying the measured elevation difference.
  - **This corrects the Oct 8, 2026 entry, which had layer and level the other way round** and called the boundary a "level". `VISION.md` never stopped using the words above: §4 says "when multiple levels exist (for example Basement, Ground Level, Second Floor), each may have its own plan image"; §4 and §6 use "layer" for what an application adds to an established level; and §6 says Floor Survey's topo areas "must not be confused with the shared canvases/levels established in Plan Setup" — which is exactly what calling a boundary a level did. The Vision outranks this log, so this is a correction back to it rather than a change of direction.
  - Use these three words. The code's older names (canvas, area, boundary) mean the same things and are not worth a rename on their own, but nothing new should add a fourth word for any of them.
- **Report Builder tells the story in the order Tim sets it.** Slides already move with Earlier and Later on the rail, and that is what orders the levels in the report. Levels are assembled in the order they were added in Customer Setup, which is a starting point, not the finished sequence.
- **A level does not need to know what it is (DECIDED Tim, Oct 8, 2026).** Tim: "Hand ordering is fine." Nothing records that a level is a basement rather than a second story, and nothing should: it is the name the investigator typed, and the report's sequence is set by moving slides with Earlier and Later. No picked list of level types, no inferred ordering. (Recorded Oct 8 as "a layer does not need to know what it is"; the subject is the storey, which is now called a level.)

### The contour layer — DECIDED and BUILT Oct 10, 2026

Authorized by Tim after the design was talked through: "It might be best to start with the Distress Survey contour layer."

- **Why it is worth doing.** Tim: "The real bang for the buck is that I could show an owner in the field what the pattern looks like and where the damage groups, and pretty much tell the story right then." `VISION.md` §11 already asks for this — showing the owner the result at the property before leaving — so this is a Vision item that was never built, not a new direction.
- **It is a layer on a level, not another level.** The level keeps its identity, so the pins, the photograph numbering, the drawings, the front door and north are untouched. Only what is drawn underneath them changes. Tim: "It's not a new canvas, it's a new layer."
- **Alignment is free.** Distress and Floor Survey already read the same plan picture for a level and both measure in that picture's pixels, and pins are stored in those pixels. A contour drawn across the plan's full extent therefore lands pin-perfect with nothing to register.
- **A saved picture, not a live render.** Floor Survey already draws contours-only in black and white. One action there writes the result onto the level as a second layer, the same kind of media as the plan. Distress then chooses which layers to show — nothing to compute in a crawlspace, it syncs as bytes, and it works offline.
- **Saved transparent, so layers stack.** Plan, contour, or both. On white it could only replace, which is not a layer. Both together — contour lines over the real plan with the damage pins on top — may be the one that tells the story best.
- **A snapshot is acceptable because the survey is finished first.** Tim: "Once a floor survey is done we don't typically do more points." So no staleness machinery; at most a line saying when it was made and a way to remake it.
- **Diagnostics was considered and set aside.** It would have been cheaper — desktop, live render, no change to the capture app — but the value is in the field, in front of the owner, and Diagnostics is a desk workspace (`VISION.md` §13, and the Oct 3 device-intent decision).
- **The boundary on screen is the one that travels** (DECIDED Tim, Oct 10, 2026, on seeing it). Combined was chosen first and was wrong the moment it was looked at on a real job: a garage is sloped to drain, so its contours are the steepest thing on the drawing and say nothing about the house. Tim: "Two separate levels should not necessarily show the same thing, plus that's a garage, it's sloped for drainage." Pick the boundary in Floor Survey before sending and that is what the layer holds — the same what-you-see-is-what-you-send rule as the B&W gate, and no control of its own. All boundaries still sends all of them.
- The layer records which boundary it covers, the send says which one it sent, and Distress names it on the pill. Sending the wrong surface otherwise looks exactly like sending nothing, which is how the first version of this read.
- **The B&W lines are the honest view across surfaces.** Every contour sits on the same absolute grid of the chosen step, so tight lines mean steep in the same way everywhere. It is the colour fill that is not comparable between boundaries, because each one is re-ranged to its own high and low with its own legend.
- **The button appears only on B&W lines** (DECIDED Tim, Oct 10, 2026). Tim: "I wonder if the button only triggers when we do black-and-white contours." It does, which makes it what you see is what you send — there is no mode for the writer to override, so the picture that lands under the pins is the one on the screen. The single exception is the reading labels, which come off because the pins go where those would be.
- **Where the two controls sit** (DECIDED Tim, Oct 10, 2026). In Floor Survey, **Send to Distress Survey** under the Mode control in the Contours panel. In Distress, a **layers pill on the same row as the level pill**, in the same style, appearing only when that level has a contour. Both keep the working surface clear.
- **Plan, or Plan + contour (DECIDED Tim, Oct 10, 2026).** Two states, not three. The layer is saved transparent, which is what makes the second one possible at all. Contour on its own was built and then dropped on sight — Tim: "I honestly don't know if we need this view," then "I think we can get rid of contour only." Without the walls the pins float and a hall cannot be told from a bedroom, so Plan + contour did everything it did and more. The plan is now never hidden.
- **A fresh media id on every write.** Sync treats media as immutable — it skips the upload when the id is already in the Cabinet and skips the download when the id is already on the device — so replacing the bytes under a stable id would leave the Cabinet holding the first contour for ever. A new id propagates; the old one is retired only after the record is safely saved, which is the Save-checkpoint ordering.
- **Replacing a level's plan drops its contour,** which was drawn against the old plan and is therefore wrong rather than merely old. It goes with the front door and the rooms, for the same reason they do.
- **Which layers are showing is a view, not data.** It lives for the session like the zoom and is never written to the Customer File.
- **Accepted on a live job (Tim, Oct 10, 2026):** 15 Rabbitbrush, 52 pins over the house contours with the garage left out. "I couldn't be happier with this. This is excellent."
- **Leaning, NOT YET DECIDED: this becomes the usual Distress view in Report Builder.** Tim: "I almost think this is most likely going to be the view in Report Builder more often than not, because it's very telling." Not authorized. What it needs settled first is whether the layer choice is a per-page rendition on the figure rail — which is what "lock the picture, not the rendition" would say — and what a page defaults to when its level has a contour. The Distress and Report Builder choices were already decided to be independent of each other.

**Found while tracing the media, not fixed here:** the Floor Survey recovery PDF uses a stable media id (`fsrec_<level>`) and overwrites its bytes on every Save. Because sync skips media whose id already exists at either end, the Cabinet keeps the *first* recovery PDF for a level for ever, and a device that has pulled one keeps that one. The field checkpoint is the thing meant to survive a lost device, so this is worth a decision. It is Floor Survey checkpoint behavior and was outside this slice.

---

## The figure rail

- **Every figure page carries a title rail down its right-hand edge (DECIDED Tim, Oct 8, 2026).** Tim: "This actually looks pretty sharp. We can do this for the picture pages, we can do this for the Distress Survey, everything but the discussion. These look more like figures now."
  - The rail is a full-height column at the right, separated from the drawing by a rule, holding in order: the residence and property address; **DRAWING TITLE** and the title itself; **SURVEY DATE** with the date and "Corrected for flooring differences"; **RELATIVE READINGS SUMMARY** with High, Low and Difference per level; the figure number; and the Sandia Geo mark at the foot.
  - It replaces the scattered corners: the upper-right address block, the floating logo and the separate lower-right readings box all collapse into it.
  - It is for figure pages — Floor Survey, Picture Locations, Pictures, Distress. **Not the discussion**, which is a page of prose.
  - **Narrow, left-aligned, and quiet (DECIDED Tim, Oct 8, 2026, by template).** The rail is about 12.5% of the sheet width and every line in it is left-aligned. Right-justification was discussed and then settled the other way by the template Tim issued: "This is your template. I accept nothing less than this." Tim: "The strip is too large for the page. It's not about us, it's about the customer." So: the residence is the largest thing in the rail and still modest, the drawing title next, and the date, "corrected for flooring differences" and the readings all small and quiet. Figure N sits at the foot at reading size and the Sandia Geo mark under it, small. Nothing in the rail may pull the eye off the drawing.
  - 9% was tried and is too narrow: the drawing title breaks into a column of single words. If it must go narrower, the lever is a shorter drawing title, not smaller type.
  - **Figure N stays in the upper left of the drawing area**; the drawing title there goes, because the rail carries it.
  - **The north arrow lives at the top of the rail, and stays rotatable (DECIDED Tim, Oct 8, 2026).** It is reference matter like everything else in the rail, and moving it there clears the last floating object off the drawing. Rotation stays because north is not always up.
  - **The north mark is variation F** (DECIDED Tim, Oct 8, 2026): a slim two-tone north point inside one open ring, with the N standing above it. Chosen over G, whose pointer breaks the ring, because that overhang sweeps outside the circle as the mark turns and needs clearance the rail has not got.
  - **Order in the rail, top to bottom:** compass rose with N above it, residence and address, drawing title, survey date and "corrected for flooring differences", relative readings per level, and the Sandia Geo mark alone at the foot.
  - **Figure N is in the upper left of the drawing, and only there.** It is not repeated at the foot of the rail.
  - **The rail is set in a serif.** Tim first said "we use the font of this presentation", and the deck's sheets are Arial — but on seeing the rail in the report's own sans he said the fonts did not look good, and the template he then held up as "significantly better" is serif throughout. The serif is what makes the sheet read as a drawing rather than a web page, so the rail and the Figure N on the drawing both use it. The rest of the report is unchanged.
  - **Figure N appears twice, deliberately:** upper left of the drawing, and again at the foot of the rail above the mark. Tim: "Figure one needs to be above the logo", and separately that the upper-left one is the one redundancy he keeps.
  - **The rail sits inside the page border.** Pinned to the sheet's own edges it painted over the frame's right-hand rule and took the sheet's rounded corner, so the border appeared to stop where the rail began.
  - **The aerial view of the house stays** on the drawing area. Tim: "I think it does look pretty sharp that way."
  - **The movable, lockable logo box retires on figure pages.** The mark is in the rail, so there is nothing to drag and nothing to lock.
  - **No overflow handling for the readings.** Tim: "I don't see five boundaries, this was not your typical. If we have to, we would just use different combinations." A page with more levels than the rail can list is a page that should be split, not a case to engineer around.
  - This supersedes the Oct 8 decision to drop the mark from Pictures pages: the mark lives in the rail, so it comes back on every figure page without taking space from the photographs.
  - Earlier the same day Tim had called a drawing-office title block "very mechanical". The rail is the same intent — a sheet that reads as an engineering firm's rather than a PowerPoint template's — without the gridded cells.

---

## Report Builder: Pictures pages

- **No logo on a Pictures page, and the photographs get the page (DECIDED Tim, Oct 8, 2026).** Tim: "Do we need the logo on that page? Keep the logo off and we can increase the size of the picture." The three-quarter rule earlier the same day came from the photographs crowding the Sandia Geo logo in the corner; with the logo off this page there is nothing to crowd, and the grid uses the whole area under the header. Every other sheet still carries the mark.
- **How many across is the choice; rows follow (DECIDED Tim, Oct 8, 2026).** 3, 4 or 5 across, picked on the rail, stored per page, 5 by default. Tim asked for pairs (3×1, 4×1, 4×2) and agreed to the simplification: "4×2 really doesn't make a difference", so rows are computed from how many pictures the page holds rather than chosen. One decision instead of two, and no chosen row count can leave a photograph without a cell. Fewer across widens each column and makes each picture bigger — as long as it does not push the page onto another row, which shares the same three-quarter block between more rows.

---

## Report Builder: rail previews

- **The rail shows the page, not a blank box (DECIDED Tim, Oct 8, 2026).** Tim: "Is there any way to put a preview on the slide? Right now they are just blank, I'd really like them to be a preview." Each thumbnail now renders its own page at sheet size and scales it down, so it is the page rather than a picture of one — it stays right when the page changes. Editor chrome (the lock bar, the Import toolbar, placement outlines, resize corners) is left out, the same set the print deck drops: a preview shows the deliverable.
- **A Floor Survey slide's drawing is a photograph.** That drawing is a live canvas belonging to the slide being looked at and there is only one of it, so a preview cannot mount its own. A small picture is taken while the investigator is on the slide; previews fill in as the deck is worked through and then stay. Rendering every level up front was the alternative and was rejected as too slow to open a report with many levels.

---

## Report Builder: Lock View

- **Lock View holds the framing (fixed Oct 8, 2026, found by Tim).** Tim: "I want to get the layout on the screen that I want and then lock it. The lock did not work, I was able to lock it and still move everything around." Lock saved its state and flipped its own label, but the live view was never told, so a locked slide still panned, zoomed, resized and let the chrome be dragged. It now freezes all of that and hides the corner grips. Settings are deliberately not frozen: turning contours off on a locked slide is the reason to lock it first.
- **Lock the picture, not the rendition (DECIDED Tim, Oct 8, 2026).** Tim: "Each Floor Survey slide has to have its own rendition. It needs to lock the picture but not the view." Two different things were one thing. The **picture** — where the plan sits, how big it is, how the building is framed — is the report's, shared by every Floor Survey slide, and that is what Lock View pins. The **rendition** — contours on or off, palette, labels, what is actually drawn inside that frame — belongs to the slide. So the move works as he described it: frame it once, lock it, duplicate the slide, and turn the contours off on the copy for a data-only page, or point it at another level. Duplicate already inserts the copy next and carries the settings with it. A slide that has not been given its own rendition reads the report's default; changing one slide never writes back to that default.
- **Levels land in the same place, whatever size their plan was exported at (DECIDED Tim, Oct 8, 2026).** Tim: "It's two levels of the same floor plan, so that's a ridiculous statement. If we have different zooms then the app is not working correctly." He is right. The stored view held the centre as raw image pixels, so the same camera put a different part of the building in the middle of the page on a level whose plan happened to be a different pixel size. The centre is now a fraction of the plan and the zoom was already a multiple of fit, so the framing is independent of how the plan was exported. Levels of one building flip with the plan nailed in place — which is the point of the flip chart.

---

## Customer File setup

- **Leaving the plans step can never be blocked (DECIDED Tim, Oct 6, 2026).** Tim, from the field: "There was no way for me to get out of that screen... I have to close it all the way out." Done and Back both waited for plan processing and room recognition to report finished. Neither reports when it never starts, so a recognition worker that could not load left both buttons visible and doing nothing, and the only way out was force-quitting the app. The wait is now capped: past the cap the busy state is cleared and the investigator leaves. In-flight work finishes if it can, and anything already written is already saved. A visible button that does nothing is worse than no button.

---

## Quick Capture

- **A run is a named set (DECIDED Tim, Oct 10, 2026).** See "File Explorer shows the pictures now" above for the naming and what it does to downloads.
- **The controls follow the part of the screen you can see (DECIDED Tim, Oct 10, 2026).** Tim, from the field: "When I pinched the zoom in I just know the buttons went away. Can you make the photo button just floating?"
  - The viewfinder is fixed to the page. A pinch on a phone does not move the page — it shrinks the window onto it and lets you pan around — so the bars stay where the page puts them, outside what is now visible, while the camera keeps filling the screen. The shutter was still there and still worked; it could not be seen.
  - The app already asks not to be zoomed (`user-scalable=no`), and iPhones deliberately ignore that for accessibility. So the answer is to live with the pinch, not to fight it.
  - The controls ride on one layer, and that layer is mapped onto the rectangle `visualViewport` reports as visible, scaled back down so the shutter stays the same size under a thumb. **At normal zoom nothing is applied at all**, so proven capture behaviour does not move for a fix aimed at the zoomed case.
  - **Done travels with the shutter.** Being able to shoot but not leave would be a worse trap than the one being fixed — see "Leaving the plans step can never be blocked", Oct 6.
- **Tapping anywhere to capture is deliberate, not a bug.** The viewfinder says "Tap anywhere to capture" until the first photograph is taken. Raised by Tim alongside the vanishing button and confirmed as working as designed.

---

## Distress Survey working surface

- **The stage behind the plan is white (DECIDED Tim, Oct 6, 2026).** Tim: "The background in Distress Survey is black, I would like to change that to white like Floor Survey." It was a dark grey, inherited from the standalone app; Floor Survey's working surface is white, and the two should not read as different products. A named change to the integrated capture app under the Oct 4 rule. Nothing else about Distress capture changes.

---

## Sizing of anything drawn on a plan

- **Two modes, one module (DECIDED Tim, Oct 4, 2026).** Toolbox had four different rules for sizing things drawn on a plan: screen-anchored (topo and field point labels and dots), raw image-space with no conversion at all (the High/Low markers), a browser-window tier (the stats pill base, 24/32/40 by `window.innerWidth`), and plan-proportional (all of Distress Survey). Tim: "they are tiny... for some reason we still have some formatting that doesn't look right between the different screen sizes. I would like to fix that issue once and for all."
- **The unit was not the mistake; the missing anchor was.** A size has to be anchored to something, and these were anchored to three different things — one to nothing at all. Distress already solved it: a fraction of the plan's long side, which is identical at any zoom, on any screen, and on paper.
- **Capture stays screen-anchored.** Zooming into a plan to place a reading and having the label stay readable is proven and correct for a device in your hand.
- **Presentation is plan-proportional**, and chrome **scales with the plan**: resize the topo on a slide and the pills and markers grow and shrink with it, the way resizing an image does. This applies to everything that produces a picture that leaves the device — report slides, Floor Survey export, and the recovery PDF.
- **The colour legend is the exception (DECIDED Tim, Oct 5, 2026).** Tim: "I don't want the legend to grow or shrink with the topo." The legend is a key to the drawing, not part of it, so on a page it holds one size however large the plan is drawn — the same size on every slide. The markers and the pill still scale with the plan, because they annotate points on it. In the capture app nothing changes.
- **The window-width tier is deleted.** It was the purest form of "the same file looks different depending on the screen."

---

## Readings are printed in tenths

- **Tenths of an inch is the standard, and always was (STATED Tim, Oct 8, 2026).** Tim: "These are inches in tenths, so .57 is stupid — it'll never be .57. It'll be .5, .6, .7. Tenths are the default by design; it's what we measure in." And on the record of it: "Tenths is always the default. It's not now — it always has been. You just didn't realize it."
- Not a change of direction. The app printing two places was a defect: it invented a digit the instrument never produced, so a floor read in tenths reported a difference of 1.57 in. Fixing it brought the app to the standard; it did not set one.
- **One decimal place everywhere a reading is drawn or printed:** point labels, the High/Low/difference pill, the colour legend, the figure rail, and the composed report figures.
- **Storage is unchanged.** A reading is kept exactly as it was typed; only the display rounds. Data entry and the recovery PDF still show the typed value, because that is where it is entered and what it exists to recover.
- Tim's remark that a partner occasionally reads a half tenth was background, not a requirement. Nothing was built for it.

---

## One job, two devices

- **Check Out brings the copy current (DECIDED Tim, Oct 10, 2026).** Checking out a job the device already held took the lease and handed back whatever was on that device, fetching nothing. Tim set a job up on his phone, synced it, surveyed on his iPad, checked that in, then checked out on the phone and was given yesterday's copy with the plans and none of the readings: "I checked out an empty copy and syncing them gave me my numbers, which also is not a good thing." It reconciles now — the ordinary component exchange, so newer local work is pushed rather than overwritten — and if it cannot be brought current the lease is released rather than held on a stale copy.
- **A copy knows, offline, that another device holds it.** The lock lived only in the device's localStorage and was only written while listing the Cabinet, so a device that had not listed since the lease was taken — or had no signal to list with — presented the job as ordinary and editable. The fact is now written onto the Customer File itself, so it survives a reload, cleared site data, and having no network at all.
- **Marking a copy is not an edit.** The customer component's revision falls back to the record's `updatedAt`, so stamping it carelessly would make the device that is *not* the authority look like it held the newest contact details. Nothing in the mark touches a timestamp.
- **Having a copy is not permission — holding the lease is (DECIDED Tim, Oct 10, 2026).** A job created on a device and synced up had never been through Check Out, so no lease existed for it, and the whole working-authority model only applies to a job that has one. That is how the phone and the iPad both ended up holding this job with nothing to refuse either of them. Tim: "It shouldn't have allowed me to open that file on my iPad mini regardless."
- **So a device that puts work into the Cabinet takes the lease on it.** After this there is one kind of local copy instead of two, and everything already built applies to it: the server refuses a second device, Check In releases and removes, and the held-elsewhere mark has something to report. A job created and synced now reads *Checked out to this device — Check in when finished*, which is what it is.
- **The claim never fails the sync.** The work reached the Cabinet, which is what Sync Now promised, and saying otherwise would be describing a success as a failure. If the claim itself fails the device simply is not the authority, and says so.
- This replaced a stopgap, not a principle: `MILESTONE.md` allowed first placement into the Cabinet by plain Sync "until an explicit Place/Check Out UI exists", and the test that asserted a first upload must *not* take a lease encoded that stopgap. Both now say the rule.

---

## Connectivity, and what counts as proof of it

- **`navigator.onLine` is not a connectivity test (FOUND in the field, Tim, Oct 9, 2026).** It reports whether a network interface is up, not whether anything is reachable. Tim, on an iPad mini tethered to his phone: "The screen got extremely slow and locked up... my iPad does not have Wi-Fi, I was using my cell phone as a hotspot. My phone lost signal but it never lost the link to the iPad." The link stayed up, so the app never went to offline mode.
- **Only the false direction is reliable.** No interface means no network, so that stays as the cheap negative. The positive has to be proved by a request that is allowed to fail — a HEAD at the app's own origin with a three-second deadline, asked fresh each time, because it changes while you are standing in a crawlspace.
- **Every request gets a deadline.** Nothing in sync or the service worker had one, so on a link that accepts connections and never answers they waited for the operating system, each holding one of the handful of connections Safari allows to a host. That is the difference between an app that is offline and an app that is stuck.
- **A reload must always be able to fall back to the cache.** The service worker served navigations network-first with no timeout, so opening Toolbox during exactly that failure was the one thing that could not recover.
- Sync Now answers in three seconds when there is nothing there, rather than looking like it is working for forty-five.

---

## Two views of one level on a sheet

- **A Floor Survey sheet can carry the same level twice (DECIDED Tim, Oct 9, 2026).** Tim: "It's a long narrow house and our space allows — maybe I can just put another floor plan that shows the data points." One shows the contours, the other the readings, side by side on the paper the first one is not using.
- **The rail's controls drive whichever view is selected.** Tim: "Whichever view is highlighted, that's what the rail controls control." Each view keeps its own rendition; the camera stays the book's, so the pair is framed as one figure.
- **Selection is screen-only.** Which view is being driven is marked by brackets at its corners and never prints — the sheet is a presentation, not a selection surface.
- **The second view opens as a copy of the first, and nothing else.** Floor Survey already has the control that makes one of them readings-only — Colour fill / Cells / B&W lines / Points only — and it is already in this rail. Tim: "I don't want you to reinvent something, it's already in the code, it's already in the rail functions."
- **A mounted view does not re-fit when its frame resizes**, so going from one view to two left the first still fitted to the full-width frame it was born in, and the pair came out at two scales. Both are dropped and remounted when the count changes, and they now frame identically.
- **A picture's chrome scales with the picture, and the readings were the exception (FIXED Oct 10, 2026).** The symptom was recorded as the plan drawing at a quarter scale with the readings at full size. Measured, the plan was exactly right — fitted to its frame in both layouts — and the readings were the whole fault: they were screen-anchored, so halving the frame doubled their size *relative to the plan* and they swamped the drawing. Chrome's share of the plan went 2.8% at one view to 4.5% at two; it is now 2.67% and 2.42%.
- The Oct 4, 2026 rule already said presentation is plan-proportional and chrome scales with the plan. The H/L/Δ pill and the High and Low markers were converted then; the reading labels and their dots were missed. They now use the same helper. Capture is untouched and stays screen-anchored, which is the proven behavior for a device in your hand.
- At the default fit the two formulas land within about 5% of each other, so an existing one-view slide does not move. The difference only appears once the plan is resized — which is the case being fixed, and the same reasoning as the legend.
- The live slide and the composed figure now size labels by one rule instead of two approximations of it, so a composed figure matches the slide it came from by construction.

---

## Handles on the floorplan

- **90° corner pulls, not tiles (DECIDED Tim, Oct 9, 2026).** Tim: "I don't like the circles on the corners, I like the corner 90 degree pulls better for this, and only present when the floorplan surface is selected. The circles printed." A filled tile sits on the drawing and reads as part of it; two lines meeting at a right angle frame the corner and leave the drawing visible underneath.
- **Only while the surface is selected,** and never on paper.
- Outstanding: Tim is seeing round handles that print. Neither set in the code is round and both are suppressed in print, so there is a third thing not yet found. To be settled from a screenshot of the printed sheet.

---

## Writing on a report sheet

- **A text box grows with its text (DECIDED Tim, Oct 9, 2026).** Tim: "The text box is not like a PowerPoint text box, it's still some weird thing that we started with." It was a fixed rectangle with the text clipped to it, so past about the fourth line the writing was still there and invisible. Its stored height is the floor it starts at now, never a lid, and its grip sets the width — the measure the words wrap to — not the height.
- **The rail carries a note the investigator writes (DECIDED Tim, Oct 9, 2026).** Tim: "Put a text box on the picture rail that gives me access to basically all of the formatting controls." It is the same kind of field as the rest of the report's writing, so the formatting controls in the top rail work on it with nothing added. Available on every railed page, not only Pictures.
- The field shows where it is on hover and when the caret is in it, and is invisible otherwise; nothing of the field itself prints, only what was written. An empty box ruled onto every figure would be chrome on a page whose point is not having any.

---

## North on a report figure

- **The arrow is derived, not left at zero (DECIDED Tim, Oct 9, 2026).** Tim: "Get the arrow pointed in the correct direction, oriented for the floor plan. Distress Survey is right."
- **The arrow is Distress Survey's own (DECIDED Tim, Oct 9, 2026).** Tim: "I like the north arrow that is already in Distress Survey better than what we have. I liked the little colour in it too." Same geometry, same paper dial and ink stroke, and the same `--accent` red the pins are drawn in — so the two marks on a Toolbox drawing belong to each other. The whole instrument turns, the N with it, as it does there.
- **The rule comes from Distress Survey,** which already answers this: the front door's real-world facing is known, and the arrow turns so that facing lines up with the direction the front door lies in on the plan.
- **One correction to it.** Distress assumes the front of the building is drawn at the bottom of the plan. Tim: "I rarely place the floor plan where the FD is always one direction." Plan Setup already records where the front door was tapped, so that direction is measured rather than assumed. Where the plan *is* drawn front-down the measurement comes out the same and this reduces to exactly Distress's rule; where it is not, the report is right and the front-down assumption is not.
- **A hand turn still wins.** Turning the arrow on a sheet pins it for that sheet; untouched sheets follow the front door.
- Where the plan is not drawn front-down, Distress Survey's own on-screen arrow will differ from the report's. The report's is the correct one. Distress capture is not changed here.

---

## The rail on every figure page

- **Every figure page carries the rail (DECIDED Tim, Oct 9, 2026).** Tim: "Everything gets the rail — that's the whole point of that rail, isn't it?" Floor Survey, Picture/Damage Locations, Pictures, Diagnostics, and any page type added later. Each one's own heading, figure number and brand mark come off the sheet, because the rail already carries all three.
- **Three pages do not take it.** The cover, which is its own design and carries its own mark; Discussion, excluded from the start; and a reserved placeholder ("No Floor Survey is stored on this Customer File"), which is scaffolding, not a figure — given a rail it announced a drawing title and a survey date over an empty sheet. A placeholder keeps the corner mark and the page number.
- **One rule, not a list of page types,** so a page type added later gets the rail without anyone remembering to add it.
- **Pictures pages:** same rail — residence, address, drawing title, figure number and the mark.
- **The compass is only on drawings of the building** — Floor Survey and Picture/Damage Locations. A sheet of photographs is not oriented to anything.
- **Five across stays.** With the rail, five across gives a 2.52 × 3.36 in plate; without it, 2.95 × 3.93 in. The rail costs about half an inch each way. Four across with ten photographs does not make them bigger — it makes three rows and a smaller plate.
- Landscape photographs are limited by the column width, not by the plate's shape, so letterboxing them in a portrait plate leaves grey but does not shrink the picture. Making a landscape shot bigger means letting it span two columns — not decided, not built.

---

## Picture/Damage Locations page

- **The pre-printed form is gone (DECIDED Tim, Oct 9, 2026).** Tim: "That funky pre-lined template is no longer what I want. I never really wanted it that way — that's just how I had to make it for my boss at my day job, but this is my app, this is what I want." The page ruled a fixed number of empty rows down the sheet whether or not there were pins for them, and cut a long note off at one row's height.
- **Drop the pre-filled column, keep the room (DECIDED Tim, Oct 9, 2026).** The Location column was the room — picked from the room list in Distress, typed as a custom label, or guessed from the plan's room outlines when it was not set. The column goes; the room itself stays, run in bold at the head of its note: "Kitchen — stair-step crack, north wall." Present when the pin has a room, absent when it does not, never an empty field. It is not part of the note's text: the note is the investigator's to write and is stored, the room belongs to the pin. Columns are Photo, pin number, and the note.
- **Content sets the layout, not the other way round.** Tim: "Things need to just scale to fit properly. If the distress map needs to get smaller, if the notes need to get less wide, it can get more tall, and if we have to use more pages, so be it." A row is as tall as its own text; four lines take four lines.
- **Rules stay, empty rows do not.** Tim: "We can even put the lines down for the reader to read it easily, they just don't need to be a bunch of empty lines."
- **A short schedule sits centred** in its column rather than hanging from the top of a page it does not fill. Tim: "If there's only two pictures, the two lines need to be in the middle of the page."
- **A long one runs onto more sheets,** one column carried on, and each sheet repeats the same map — a reader looking up photograph 31 on the second sheet needs the plan as much as the one looking up photograph 3 on the first. A continuation sheet is the same figure continued, not a new figure, and is not a second line in the contents.
- **The rail is on this page too.** The map keeps its place; the page's own title, figure number, north arrow and mark are gone from the sheet because the rail already carries them. Tim: "Obviously we keep the new rail that we've been working on."
- **The sheet is a presentation, not a selection surface (DECIDED Tim, Oct 9, 2026).** Tim: "I do not want the cream. This is a presentation mode, not a selection mode." The selected row's highlight is gone from the page entirely; which pin is being worked on shows in the photograph panel beside the sheet. The ring on the selected marker stays on screen, because it is the only sign of which pin a drag will move, and never prints. No selection state is saved to the Customer File.
- The split is measured on a fixed reference sheet, not on the sheet as drawn, so a report does not repaginate when the window is resized.

---

## Closeout

- The final PDF is the durable closeout record. Exact long-term archival packaging (ZIP structure, folder conventions, etc.) is not yet decided.

## Process

- Build one vertical slice at a time; the repository has one current milestone.
