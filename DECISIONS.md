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

- Is PowerPoint-like and flexible — direct page composition, not a rigid generation form. Automatic assembly is a starting point; the investigator owns and adapts the pages afterward.
- The 1515 Los Nietos report is the initial build baseline (structure, hierarchy, figures, presentation) — a baseline to reproduce first, not a permanent immutable template.
- Will support basic drawing/annotation on report content; the exact toolbar is not yet decided.
- Follows "protect the canvas" — compact pills and collapsible tools, not a permanent desktop-style ribbon.
- Comes before Diagnostics in the **application** build order: an operational Toolbox (Customer File → Distress/Floor → Report Builder) should be possible before Diagnostics is required.
- Report Builder and Diagnostics are not wholly future work. As of Sept 24, 2026, this repository has a Report Builder shell and a Diagnostics entry, and further integration is in active pull requests (#68 Diagnostics workbench, #69 Report Builder evidence, #70 Report Builder skeleton). They obey the same Customer File lifecycle. Sync work must not redesign them or field capture.

## Diagnostics

- Integration has started. Exact analytical tools/methods are not yet decided. Not a mandatory gate for every report.

## AI collaboration

- Will be model-agnostic — no permanent dependency on a single AI vendor. This is future architecture, not an early milestone.

## Open product questions / possibilities — NOT YET DECIDED

These notes preserve active product possibilities so they are not lost. They are **not implementation authorization or requirements**. Do not implement them unless the product owner explicitly decides and authorizes the relevant scope.

- **Quick Capture / Customer File photos:** Quick Capture may remain conveniently accessible from Distress Survey while the resulting photographs are stored with the Customer File. A possible workflow is to choose a subject such as Interior, Exterior, Grading & Drainage, or Other, with the resulting photo folder named from the subject plus the date the photographs were taken. Exact workflow, storage shape, and UI are not yet decided.
- **Report Builder startup:** Report Builder may substantially self-populate from information Toolbox already knows rather than beginning with a gateway questionnaire. Questions may instead appear only for particular report pages/sections where Toolbox cannot infer the needed context. Exact workflow is not yet decided.
- **AI-assisted reporting:** Future model-agnostic AI connectors may use structured Customer File and application information to help organize evidence, summarize material, ask targeted questions where professional context is missing, and assist with technical report drafting. Exact interaction and architecture are not yet decided.
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
- **Delete follows the cabinet copy, not the checkout flag.** `checkedOutFromCabinet` records that this device checked the file out. It does not mean a file without that flag is local-only. If Delete finds a live File Cabinet index, it moves that server copy to File Cabinet Trash and removes the local working copy only after Trash is confirmed. A file with no remote index is deleted on this device. If the cabinet cannot be reached and the file may already have been mirrored, the local file stays and the delete remains pending. A checkout held on another device is refused.
- Do not redesign Distress capture, Floor Survey capture, or Customer File; do not build a Control Panel as part of this work.
- iPhone, iPad, installed PWA, and desktop browser are equal Toolbox devices.
- Continuous live deployment remains required during development so the product owner can inspect real progress on those devices.

### Superseded

- Full-cabinet convergence across devices after Sync Now (“Device B Sync receives Device A’s entire library automatically”) is **superseded** by the File Cabinet + selective local + exclusive checkout model.
- “Manual Sync Now is v1; quiet automatic sync is later polish only after manual sync is trusted” is **superseded**. Quiet mirroring of the active working Customer File is decided. Sync Now remains the manual confidence action and must use the truthful wording above.
- Reading “Cloudflare is the authoritative File Cabinet” as “the cloud is the live editing authority” is **superseded**. Editing authority is the active local device. The File Cabinet is the shared, transfer, and filed location and the device-loss mirror.

## Closeout

- The final PDF is the durable closeout record. Exact long-term archival packaging (ZIP structure, folder conventions, etc.) is not yet decided.

## Process

- Build one vertical slice at a time; the repository has one current milestone.
