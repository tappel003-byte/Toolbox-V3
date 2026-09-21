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
- The Customer File is one **job container**. Sub-files/components inside it: Customer Information, Plans/Canvases, Distress Survey, Floor Survey, and (when built) Diagnostics and Report Builder. Media belongs to or is referenced by the appropriate component.
- Plans belong to the Customer File. They are not owned by Distress Survey or Floor Survey.
- There is no fifth “Plan Setup” application and no Plan Setup gatekeeper in the product model.
- Rooms, room names/locations, plan images, orientation/front door, and related shared spatial setup are Customer File data.
- Applications pull what they need from the Customer File and add their own application-specific layers.
- Changing applications does not copy or recreate Customer File plans.
- **KISS:** If a change cannot be explained in 2–3 plain sentences, simplify before implementing.
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
- Cross-device Customer File synchronization is authorized **ahead of** building Report Builder or Diagnostics.

## Diagnostics

- Exact analytical tools/methods are not yet decided. Not a mandatory gate for every report.

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

- **Local-first:** local IndexedDB remains the working storage apps use. Cloudflare is the private central cabinet for exchanging Customer File components between devices.
- **Save** = local, immediate, offline-capable persistence on this device.
- **Sync Now** = separate visible action that exchanges changed components and their required media with the cloud cabinet. Manual Sync Now is v1; quiet automatic sync may be considered later after manual sync is trusted.
- **Component-level synchronization:** Customer Information, Plans/Canvases, Distress, Floor Survey, and future Diagnostics/Report Builder sync independently. The entire Customer File is not one last-write-wins document. Unrelated component edits on different devices must not overwrite each other.
- **Same-component conflict (v1):** newest component version wins. No CRDTs, live collaboration, presence, or merge UIs.
- Plans and Distress photos must synchronize as **actual media**, not references alone.
- After a Customer File has synchronized onto a device, that device must open and work on it offline without cloud dependency.
- Authentication may be required to Sync Now; it must **not** be required to open or use already-local Customer Files offline.
- **Starting access:** Cloudflare Access for Tim and Lee, provided it does not interfere with required offline local use.
- **Shared library:** Tim and Lee share the same Customer File library. No SaaS tenancy, roles, invitations, billing, customer accounts, or per-file permissions.
- **Minimum cloud infrastructure:** Cloudflare Worker + private R2 unless implementation proves a concrete need for something else. Do not add D1, KV, Durable Objects, Queues, Firebase, Supabase, or similar without that proof.
- Preserve existing recoverable Customer File Trash and 120-day retention intent; delete/restore state must synchronize so old device copies do not silently resurrect active files.
- Cross-device synchronization is **current authorized work** and is ahead of Report Builder / Diagnostics implementation. Do not redesign Distress capture, Floor Survey capture, or Customer File; do not build a Control Panel as part of this work.
- iPhone, iPad, installed PWA, and desktop browser are equal Toolbox devices for sync.
- Continuous live deployment remains required during development so the product owner can inspect real progress on those devices.

## Closeout

- The final PDF is the durable closeout record. Exact long-term archival packaging (ZIP structure, folder conventions, etc.) is not yet decided.

## Process

- Build one vertical slice at a time; the repository has one current milestone.
