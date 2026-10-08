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
- **File Explorer is not usable as a way to find photographs (raised Tim, Oct 4, 2026).** "The way that they are shown in File Explorer is unusable. All of the Distress pictures need to be in a folder... right now we have all the Quick Capture pictures and it does nothing with them. Those need to live in a file where I can open them up and look at them... right now those pictures are useless unless we open the app, and there really is zero way to get back to the Quick Capture photos." Two separate problems: Distress photographs are not grouped into anything a person can browse, and Quick Capture photographs are a dead end — taken, stored, and then reachable only by reopening the application that took them. Not scoped or authorized; the folder shape overlaps the Quick Capture note above and the two should be settled together.
- **The topo control rail is cluttered and should be rethought for both screens (raised Tim, Oct 6, 2026).** Tim: "The rail is just very cluttered and I don't like it, it's not usable... I didn't like the one of the pills in Floor Survey anyway, so whatever we do we are probably doing it to both screens, Floor Survey and Report Builder." One rethink, applied to the field app and the report slide, not two separate layouts. An idea he floated: the colour contour controls, including reverse, could be a floating pill the investigator moves around the canvas rather than a panel pinned to the rail. Not scoped or authorized. Whatever is settled here is to be recorded before it is built, and the Report Builder side of it counts as a named capture-app-adjacent change under the Oct 4 rule.
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

## Report Builder: Lock View

- **Lock View holds the framing (fixed Oct 8, 2026, found by Tim).** Tim: "I want to get the layout on the screen that I want and then lock it. The lock did not work, I was able to lock it and still move everything around." Lock saved its state and flipped its own label, but the live view was never told, so a locked slide still panned, zoomed, resized and let the chrome be dragged. It now freezes all of that and hides the corner grips. Settings are deliberately not frozen: turning contours off on a locked slide is the reason to lock it first.
- **Lock the picture, not the rendition (DECIDED Tim, Oct 8, 2026).** Tim: "Each Floor Survey slide has to have its own rendition. It needs to lock the picture but not the view." Two different things were one thing. The **picture** — where the plan sits, how big it is, how the building is framed — is the report's, shared by every Floor Survey slide, and that is what Lock View pins. The **rendition** — contours on or off, palette, labels, what is actually drawn inside that frame — belongs to the slide. So the move works as he described it: frame it once, lock it, duplicate the slide, and turn the contours off on the copy for a data-only page, or point it at another level. Duplicate already inserts the copy next and carries the settings with it. A slide that has not been given its own rendition reads the report's default; changing one slide never writes back to that default.

---

## Customer File setup

- **Leaving the plans step can never be blocked (DECIDED Tim, Oct 6, 2026).** Tim, from the field: "There was no way for me to get out of that screen... I have to close it all the way out." Done and Back both waited for plan processing and room recognition to report finished. Neither reports when it never starts, so a recognition worker that could not load left both buttons visible and doing nothing, and the only way out was force-quitting the app. The wait is now capped: past the cap the busy state is cleared and the investigator leaves. In-flight work finishes if it can, and anything already written is already saved. A visible button that does nothing is worse than no button.

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

## Closeout

- The final PDF is the durable closeout record. Exact long-term archival packaging (ZIP structure, folder conventions, etc.) is not yet decided.

## Process

- Build one vertical slice at a time; the repository has one current milestone.
