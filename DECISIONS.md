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

- The Customer File owns shared context (customer/contact info, plan/surfaces, etc.) so it's entered once and used everywhere it's needed.

- The Customer File is a full customer/contact record for Toolbox, not a form limited to fields Distress Survey or Floor Survey currently require. Useful customer information may be captured even when no current workspace consumes it; Toolbox can use it later.
- Customer Files may be incomplete. Only the minimum information needed to create and recognize a file should gate creation; other contact information can be added or corrected later.
- Distress Survey and Floor Survey were built as standalone applications before the Toolbox Customer File model existed. Their standalone setup/data plumbing does not define Toolbox architecture.
- **Integration rule: plumbing may change; proven capture behavior is protected.** Toolbox may change shared-data ownership, file identity, persistence, synchronization, and how known context reaches a workspace. Integration must not casually redesign proven field-capture interactions.

## Distress Survey

- Supports multiple user-named surfaces within one continuous survey. Rationale: real jobs span more than one building surface, and the surfaces shouldn't be hard-coded or forced into separate jobs.
- Uses a compact active-surface pill on the capture canvas to switch surfaces, keeping the canvas itself uncluttered.
- Pin numbering is one continuous chronological sequence across all surfaces in a survey; assigned numbers remain stable and are never regrouped by surface. Rationale: numbering ties directly to the physical photo-capture sequence and must not be reshuffled after the fact.

## Floor Survey

- Supports multiple user-named surfaces/levels within the same Customer File; each level is its own measured dataset. Distinct from Distress's model — Floor Survey's levels are separate datasets, not one continuous survey.
- Survey Date is required metadata belonging to the measurement dataset, not a generic job date — it identifies when that specific set of measurements was taken.
- Topo Boundary is Floor-Survey-specific information, distinct from the shared Customer File plan/surface.
- The existing "three-dots → Edit" is presentation editing only (labels, emphasis, decluttering) — it must never silently change underlying measured data. Actual measurement corrections happen in Floor Survey's own data-input/capture functionality.

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
