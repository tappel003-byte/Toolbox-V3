# Milestone 2 — Standalone Plan Setup and Distress Seam

## Purpose

Correct and complete the first working standalone Plan Setup workflow inside an open Customer File, then establish the clean seam from those shared canvases/levels into proven Distress capture.

Milestone 1 — Customer File is complete.

## Status

**Current milestone.**

The first live Plan Setup cut exposed an architectural documentation error: Plan Setup was incorrectly modeled as Distress-owned setup. That interpretation is superseded. The architecture below is authoritative for this milestone and must agree with `VISION.md` and `DECISIONS.md`.

## 100% locked architecture

**Plan Setup is a standalone, first-class Toolbox component and gatekeeper.**

A plan/level/canvas is established once in Plan Setup for the Customer File. Distress Survey, Floor Survey, and future consumers use that same established canvas/level and add their own application-specific data layers.

Do not create a Distress-owned plan setup, a Floor-Survey-owned plan setup, or workspace-specific copies of an established plan/level.

Changing applications changes the application-specific layer, not the underlying canvas/level. When multiple canvases/levels exist, the investigator switches among those established canvases/levels inside the active field application.

Examples:

- One established level → the same underlying canvas is available to Distress and Floor Survey.
- Basement + Ground Level + Second Floor → those same three established canvases/levels are available within each applicable field application.
- Distress may contain observations across all three while remaining one continuous Distress Survey.
- Floor Survey may hold its own boundaries, exclusions, measurements, and topo data for each applicable established canvas/level.

## Current implementation correction

The live implementation currently places shared Plan Setup data under Distress ownership. Correct that ownership without discarding working Plan Setup functionality unnecessarily.

Shared Plan Setup should own the established plan/level data such as:

- plan/level identity and user-visible name
- usable plan image
- room names/locations and other shared room setup
- orientation/front-door setup where applicable
- other genuinely shared spatial setup information

Distress should own only Distress-specific survey data associated with an established canvas/level.

Floor Survey is not being implemented in this slice, but the corrected data boundary must allow Floor Survey to consume the same established canvases/levels later without recreating them.

## Distress seam

After standalone Plan Setup ownership is corrected, integrated Distress capture attaches its Distress layer to the selected established canvas/level.

Distress is one continuous survey across canvas/level switches.

### 100% LOCKED — Distress numbering must preserve exactly

The integrated implementation must preserve the proven `field-reporter-pro` behavior exactly:

- pins represent observation/locations and photographs remain attached to them
- photograph numbering is one continuous sequence across the entire Distress Survey
- multiple photographs at one pin consume a contiguous number range
- adding/deleting earlier photographs recomputes subsequent photograph numbers
- deleting a pin and its photographs closes that range and subsequent numbers shift
- the next pin's displayed starting number follows that sequence
- switching canvases/levels never restarts or groups the numbering

This is not open to reinterpretation or simplification.

## In scope

- Correct Plan Setup from Distress-owned to standalone shared ownership.
- Preserve the useful working Plan Setup functionality already built where it fits the corrected architecture.
- Expose standalone Plan Setup naturally from an open Customer File.
- Establish and name one or more plans/levels/canvases once.
- Persist shared Plan Setup data reliably across reload, close/reopen, and appropriate offline use.
- Reuse Customer File context without re-requesting known information.
- Make established canvases/levels available to Distress without copying or recreating them.
- Provide compact canvas/level switching within Distress when multiple established canvases/levels exist.
- Attach proven Distress capture behavior to the selected canvas/level.
- Preserve exact locked Distress numbering across canvas switches.
- Responsive desktop, iPad, and phone behavior.
- Live deployment and meaningful owner review.

## Out of scope / unresolved

- Floor Survey implementation itself.
- Redesigning proven Distress capture behavior.
- Modifying either standalone reference repository.
- Report Builder, Diagnostics, or AI integration.
- Speculative future infrastructure.
- Exact treatment of non-level spatial areas such as Exterior, Patio, Roof Parapet, Rear Addition, and other unusual planes. This remains **NOT YET DECIDED**; stop for product-owner clarification rather than inventing ownership or workflow.

## Acceptance

This milestone is complete when:

- Plan Setup is visibly and architecturally standalone, not a Distress setup screen.
- A plan/level is established once and persists as shared Customer File spatial data.
- Multiple established canvases/levels can be named and switched where needed.
- Distress consumes those established canvases/levels without recreating them.
- Distress capture works on the selected canvas/level.
- Distress numbering follows the exact 100% locked proven standalone behavior across canvas switches.
- Known Customer File and Plan Setup information is not requested again.
- Appropriate offline/reopen behavior is tested.
- Desktop, iPad, and phone layouts are usable.
- Standalone reference repositories remain unchanged.
- The actual diff is reviewed against `VISION.md`, `AGENTS.md`, and `DECISIONS.md`.
- The working cut is deployed live for owner review.

## Important

A stated need is not permission to invent ownership. If an ambiguity materially affects shared Plan Setup ownership, canvas/level identity, application-layer ownership, locked Distress behavior, or the professional deliverable, stop and ask.

The owner reviews meaningful working product checkpoints rather than supervising routine implementation.
