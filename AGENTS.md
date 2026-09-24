# Toolbox-V3 — Agent Rules

Operational guardrails for anyone (human or AI) implementing Toolbox. This is enforcement, not product philosophy — see `VISION.md` for that.

## Before doing anything

- Read `VISION.md` before doing work. If code, a milestone, or any other document conflicts with `VISION.md`, **VISION.md wins** — unless the product owner explicitly changes the Vision.
- Work only on the current `MILESTONE.md`. Do not implement future milestones early, even when the work is already understood conceptually.

## Implementation prompt protocol

- Every implementation prompt given to an AI coding agent must begin by requiring the agent to read the entire current `Toolbox-V3` repository before making changes.
- The prompt must explicitly re-establish repository authority: `VISION.md` first, then `AGENTS.md`, `MILESTONE.md`, and `DECISIONS.md`. Current code follows those documents. V2 and standalone applications are evidence/reference only unless the task specifically calls for inspecting them.
- The agent must inspect the current implementation relevant to the task before editing it, work only within the current milestone and prompt scope, and stop/report any material conflict rather than silently resolving it.
- Every implementation prompt must end by requiring the agent to report exactly which files changed, what changed, any decisions or assumptions made, and the commit SHA.
- This protocol applies to small prompts as well as substantial implementation work so every coding task begins from the same source of truth.

## Authorization

- A stated need is not an approved architecture.
- Brainstorming is not implementation authorization.
- Routine implementation details do not require product-owner approval.
- If ambiguity would materially affect workflow, data ownership, proven behavior, architecture, or the professional deliverable, **stop and ask** rather than silently choosing. Batch non-blocking questions for a meaningful review checkpoint when practical, instead of interrupting for each one.
- One implementer modifies a given problem at a time.
- Do not "helpfully" redesign a proven workflow that's outside the current milestone's scope, even if the redesign seems better.

## Proven behavior

- Proven field behavior is presumed correct and carries a high burden of proof before it changes.
- High-risk changes to proven behavior require design review before implementation.
- Preserve proven behavior, not inherited architecture — the interaction that's field-tested is protected; the system that happened to produce it is not.
- Toolbox-V2 is evidence and reference only. It is not V3's architecture — do not force V3 around it.
- **Never modify the standalone repositories:** `field-reporter-pro`, `floorplan-topo-maker`. Integrated Toolbox copies of this capture behavior, and the plumbing that connects them, may evolve.
- Emergency standalone import into a Customer File is a **permanent** recovery path, not temporary migration scaffolding.

## Verification

- Read the actual current source or diff before claiming what code does or that behavior was preserved. Diff is proof — a claim of "unchanged" is not.
- If a shared data field changes, check its relevant downstream consumers as part of the same piece of work.
- If a bug class is found, search for structurally similar occurrences elsewhere before considering it fixed.
- Data acknowledged as saved must actually persist before navigation, reload, close, a connectivity change, or synchronization is allowed to silently discard it.

## Product shape

- Offline field capture is a core requirement, not an add-on.
- Normal internal workflow must not require exporting from one Toolbox workspace and importing into another.
- Do not expose implementation complexity to the investigator.
- Do not ask for information Toolbox already knows.
- **Customer File owns plans:** Contact + plan(s) = Customer File. Apps pull plans; no Plan Setup application/gatekeeper. **KISS and Occam’s razor:** explain in 2–3 sentences or simplify. Do not add complexity unless it solves a real problem. When two designs protect the data and satisfy the workflow equally well, prefer fewer states, buttons, decisions, assumptions, dependencies, and failure modes. Complexity that is invisible to the investigator still carries a burden of proof if it makes the code fragile.
- The Customer File is a **job container**; Customer Information, Plans/Canvases, Distress, Floor Survey, Diagnostics, and Report Builder are components inside it and obey the same lifecycle — not one undifferentiated synchronized blob.
- Switching applications changes the application-specific layer, not the underlying established canvas/level. Switching canvases/levels happens within the field application when multiple canvases/levels exist.
- Distress photograph/pin numbering must preserve the exact proven standalone recomputation behavior across all canvases/levels. Never simplify it into permanent per-pin or per-canvas numbering.
- Protect the canvas — the working surface takes priority over application chrome.

## Cross-device synchronization

- **Local-first:** apps continue to read/write the local Customer File (IndexedDB). Do not rewrite Distress or Floor Survey to operate directly against cloud storage. A Customer File actively being worked on has one editing/working authority: the active local device. The File Cabinet mirror is not a second concurrent editor.
- **Autosave, field checkpoint, and sync are different.** Autosave protects ongoing local work and stays immediate and offline-capable. A deliberate Save in integrated Floor Survey or Distress Survey creates or replaces one protected field checkpoint for that survey: replace in place, write the new checkpoint successfully before retiring the previous one, reference existing photos/plans/media, and do not create Save 1/2/3 histories. The checkpoint syncs as recovery material. Checking out a Customer File must not automatically materialize that checkpoint as the normal working survey. Distress follows the same checkpoint principle without a change to protected capture flow.
- **Quiet mirror:** when online, the active working Customer File is quietly mirrored to the File Cabinet for device-loss protection. Quiet mirroring is decided. It is not later polish. It does not replace Sync Now.
- **Sync Now** is the manual confidence/safety action after poor signal. It must say **“Sync complete.”** when changes upload, **“Everything is already synced.”** when nothing changed, and it must not describe a failure as success. It exchanges changed components and required media for this device’s local working files. It does not download the entire Cabinet.
- **File Cabinet** is the shared, transfer, and filed location. **Check Out** transfers exclusive editing authority to the receiving device. Other devices may keep complete local safety copies; after they learn the file is checked out elsewhere those copies are gray/read-only and must not mutate or sync over it. **File Explorer** is the read-only server back door, not a second Customer File editor.
- **Component-level sync:** Customer Information, plans/media, Distress, Floor Survey, Diagnostics, and Report Builder obey the same lifecycle and synchronize independently. Do not treat the entire Customer File as one last-write-wins document.
- Same-component conflict for v1: newest component version wins, as defensive/recovery plumbing. Do not build CRDTs, live collaboration, or merge UIs.
- Cloud connectivity must never be required for ordinary field capture or for opening already-local Customer Files.
- Authentication may gate Sync Now; it must not gate offline use of local data.
- Minimum cloud shape: Cloudflare Worker + private R2, with Cloudflare Access for Tim and Lee, unless implementation proves a concrete need for something else.
- Do **not** add D1, KV, Durable Objects, Queues, Firebase, Supabase, SaaS tenancy, roles, invitations, billing, or a Control Panel unless explicitly authorized.
- Do **not** redesign Distress capture, Floor Survey capture, or Customer File as part of sync work.
- Do **not** build Report Builder or Diagnostics as part of sync work. Their integration is underway separately; do not treat them as outside the lifecycle above.
- Plans and Distress photos must sync as actual media bytes, not references alone.
- Preserve existing Trash/recovery behavior and 120-day retention intent; deletion/restore state must synchronize.
- Post-release local-copy cleanup is decided and is a later small slice: after another device’s work is released and the File Cabinet copy is verified complete, the older device may offer Remove From This Device / Keep Local Copy / Archive as Revision. Do not implement that choice inside ordinary sync or capture work, and do not let it complicate normal work. Remove From This Device is local-only and is not Trash.
- Creating Cloudflare infrastructure, Access configuration, or deployment of sync services requires explicit product-owner authorization beyond documentation updates.

## Device intent

- **Field/mobile-first:** Customer File setup, Distress Survey, and Floor Survey must be designed first for practical field use on iPhone/iPad, touch-first and offline-capable.
- **Desktop-first, mobile-capable:** Distress Edit, Diagnostics, and Report Builder should exploit desktop screen space and pointer precision for editing, analysis, plots, calculations, and report composition. They should still open and provide useful functionality on iPhone/iPad, but identical layout or full desktop equivalence is not required.
- For Customer File library and Sync Now, iPhone, iPad, installed PWA, and desktop browser are equal Toolbox devices.
- Responsive design means each workspace should fit its actual use context; do not force one identical UI across phone, tablet, and desktop.

## Deployment and review

- Live deployment is required for meaningful product review.
- Product review happens at meaningful checkpoints, not for every minor implementation detail.
- Any change to user-visible UI requires a visual/layout review checkpoint before merge, when practical. Before committing, the implementing agent must explicitly inspect the resulting placement, spacing, and responsive behavior (desktop/iPad/phone as relevant), and confirm the change does not crowd or overlap existing controls or branding. This is a review requirement on the implementer, not a new product-owner approval gate for minor implementation details.
