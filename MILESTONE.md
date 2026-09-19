# Milestone 2 — Plan Setup and Distress Seam

## Purpose

Build the first working Plan Setup workflow inside an open Customer File and establish the clean seam into the proven Distress capture workflow.

Milestone 1 — Customer File is complete. The live Toolbox can create, save, find, reopen, and edit Customer Files; Customer File identity and shared information persist across reload/close/reopen and appropriate offline use; the workflow has been reviewed on desktop, iPhone, and iPad Mini.

## Status

**Current milestone.**

Milestone 0 — Live Foundation and Milestone 1 — Customer File are complete.

## Milestone 2 scope

The current slice is **Plan Setup first**.

The intended workflow is:

Customer File → Plan Setup → proven Distress capture

Plan Setup is a legitimate prerequisite to Distress capture because capture needs a usable plan/surface. Customer/contact/address fields are not gates.

### In scope

- Expose Plan Setup naturally from an open Customer File.
- Create/define the initial Distress surface, named **Floor Plan** by default.
- Add and name additional Distress plan/surfaces/levels.
- Make the active/current surface unmistakable without wasting canvas.
- Persist Plan Setup data with the Customer File across reload, close/reopen, and appropriate offline use.
- Reuse Customer File context rather than requesting known customer/property information again.
- Inspect the proven standalone Distress Survey read-only and identify the setup-to-capture seam and single-plan assumptions.
- Structure Plan Setup so proven Distress capture can attach next without redesigning protected capture behavior.
- Responsive desktop, iPad, and phone behavior.
- Keep implementation legible within the documented product-area segmentation.
- Live deployment and meaningful owner review of the first working cut.

### Multiple surfaces

Multiple named Distress surfaces are a real requirement, not placeholder text.

The first/default Distress surface is **Floor Plan**. Additional named surfaces must be possible without forcing every surface into one global-plan assumption.

Do not conflate Distress surfaces with future Floor Survey measured levels. Do not force a universal viewport across unrelated surfaces.

### Protected behavior

The standalone Distress Survey is evidence/reference and remains untouched.

Preserve proven Distress capture behavior. Replace standalone setup/customer plumbing where Toolbox Customer File and Plan Setup now own that responsibility. Do not copy the standalone application wholesale.

## Acceptance

This Plan Setup slice is complete when:

- Plan Setup is accessible from an open Customer File.
- The initial Floor Plan can be established.
- Additional named surfaces can be added and identified.
- Active/current surface context is clear.
- Plan Setup state persists reliably with the Customer File.
- Known Customer File information is not requested again.
- The implementation establishes a clear attachment seam for proven Distress capture.
- Desktop, iPad, and phone layouts are usable.
- Appropriate offline/reopen behavior is tested.
- Standalone Distress code was inspected read-only and remains unchanged.
- User-visible changes receive the visual/layout review required by AGENTS.md; code inspection alone is not represented as rendered verification.
- The actual diff is reviewed against VISION.md, AGENTS.md, and DECISIONS.md.
- The first working cut is deployed live for owner review.

## Out of scope for this slice

- Redesigning proven Distress capture behavior.
- Wholesale copying of the standalone Distress app.
- Floor Survey implementation.
- Distress Edit beyond what is strictly required by this slice.
- Report Builder.
- Diagnostics.
- AI integration.
- Full cloud synchronization/auth unless narrowly required by an actual current need.
- Speculative future-workspace infrastructure.
- Unrelated Refresh troubleshooting.

## Important

This milestone deliberately advances beyond Customer File. Plan Setup is now authorized work.

Make routine implementation decisions without requiring owner approval. Stop only when an ambiguity materially affects workflow, data ownership, protected behavior, architecture, or a professional deliverable.

The owner reviews meaningful working product checkpoints rather than supervising routine implementation.
