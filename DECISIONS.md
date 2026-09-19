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


## Customer File and Plan Setup

- The Customer File is the central organizing object and owns shared customer/job context.
- **100% LOCKED:** Plan Setup is a standalone, first-class Toolbox component and gatekeeper. A plan/level/canvas is established once and reused by the field applications.
- The established canvas/level is shared spatial building data. It is not owned by Distress Survey or Floor Survey.
- Rooms, room names/locations, usable plan image, orientation information, and other genuinely shared spatial setup belong to Plan Setup.
- Field applications add their own application-specific layers to the same established canvases/levels.
- Changing applications changes the application-specific layer; it does not create, copy, rename, redefine, or replace the underlying established canvas/level.
- When multiple canvases/levels exist, the investigator switches among those established canvases/levels inside the active field application.
- Distress and Floor Survey were built as standalone applications before the Toolbox shared Plan Setup model existed. Their standalone setup/data plumbing does not define Toolbox architecture.
- **Integration rule: shared plumbing may change; proven capture behavior is protected.** Field applications consume shared setup rather than recreating it.
- A Customer File has a stable internal identity independent of editable customer/contact fields. No human-entered customer, contact, or address field gates creation. A new unnamed file may use **TBD** as its temporary human-readable identifier.

---

## Product-area boundaries

- Toolbox should be organized around recognizable workflow/product areas: shared/core foundation, Customer File, Plan Setup, Distress Survey, Floor Survey, Diagnostics, and Report Builder.
- Shared functionality and data contracts belong in shared/core areas; workspace-specific behavior, wording, and implementation should remain within the workspace that owns them.
- This segmentation is both a maintainability and AI-context boundary. As the repository grows, implementation agents should always read the complete authority layer, then read the complete relevant product area and the shared interfaces/dependencies it uses. Unrelated workspace implementations should not be consumed or modified unless an actual dependency requires it.
- Organize for human legibility as well as machine efficiency: the product owner should be able to locate and change workspace-specific wording or behavior without searching through an undifferentiated application.
- These boundaries must not be used to duplicate shared data, create internal export/import choreography, or weaken the Customer File as the central organizing object.


## Distress Survey

- Distress Survey operates on the canvases/levels already established in Plan Setup and adds Distress-specific data layers; it does not own or recreate plan/level setup.
- Multiple established canvases/levels may be switched within one continuous Distress Survey.
- Each observation retains its canvas/level identity for downstream use.
- **100% LOCKED:** photograph/pin numbering preserves the exact proven `field-reporter-pro` behavior across all canvases/levels. A pin's displayed number follows the continuous photograph sequence; multiple photographs consume a contiguous range; adding/deleting earlier photographs or deleting a pin recomputes and shifts subsequent numbers to close/open the sequence as the proven standalone does.
- Switching canvases/levels never restarts numbering.
- This numbering behavior is not open to reinterpretation, optimization, simplification, permanent per-pin numbering, or per-canvas numbering.
- Exact treatment of non-level areas such as Exterior, Patio, Roof Parapet, Rear Addition, and other unusual planes is **NOT YET DECIDED**.

---


## Floor Survey

- Floor Survey consumes the same canvases/levels already established by Plan Setup; it does not own or recreate them.
- Floor Survey adds its own application-specific data/layers to each applicable established canvas/level.
- Topo Boundary and exclusions are Floor-Survey-specific setup associated with an established canvas/level, not shared Plan Setup data.
- Measurement points, topo data, and Survey Date belong to Floor Survey datasets.
- Shared room information from Plan Setup is available to Floor Survey so room context can be reused rather than entered again. The exact future mechanism for automatic spatial room membership is not yet decided.
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
- Comes before Diagnostics: an operational Toolbox (Customer File → Distress/Floor → Report Builder) should be possible before Diagnostics is required.

## Diagnostics

- Exact analytical tools/methods are not yet decided. Not a mandatory gate for every report.

## AI collaboration

- Will be model-agnostic — no permanent dependency on a single AI vendor. This is future architecture, not an early milestone.

## Cloud, offline, and access

- Cloud-backed does not mean cloud-dependent — loss of internet in the field must not remove the ability to capture data, only synchronization.
- Offline field capture is a required, continuously-tested capability, not an add-on.
- Initial access is two known internal users; no SaaS-style roles, billing, or enterprise administration unless a real future need arises.
- Continuous live deployment is required during development so the product owner can inspect real progress on phone, iPad, and desktop.

## Closeout

- The final PDF is the durable closeout record. Exact long-term archival packaging (ZIP structure, folder conventions, etc.) is not yet decided.

## Process

- Build one vertical slice at a time; the repository has one current milestone.
