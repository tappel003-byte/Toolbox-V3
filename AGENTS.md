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
- Protect the canvas — the working surface takes priority over application chrome.

## Deployment and review

- Live deployment is required for meaningful product review.
- Product review happens at meaningful checkpoints, not for every minor implementation detail.
- Any change to user-visible UI requires a visual/layout review checkpoint before merge, when practical. Before committing, the implementing agent must explicitly inspect the resulting placement, spacing, and responsive behavior (desktop/iPad/phone as relevant), and confirm the change does not crowd or overlap existing controls or branding. This is a review requirement on the implementer, not a new product-owner approval gate for minor implementation details.
