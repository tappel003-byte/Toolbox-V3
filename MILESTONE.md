# Milestone 1 — Customer File

## Purpose

Build the first real Toolbox workflow: create, save, reopen, and work from a Customer File that owns the shared customer/job context used by later Toolbox workspaces.

## Status

**Current milestone.**

Milestone 0 — Live Foundation was completed on September 18, 2026.

Proven Milestone 0 foundation:

- `main` continuously deploys to the live Toolbox application.
- Live production domain: `sandiageotoolbox.com`.
- Product UI is branded **Toolbox**, not "Toolbox V3."
- Installed standalone PWA behavior is working on desktop, iPhone, and iPad Mini.
- Home-screen/application icon support is working.
- Responsive shell works across desktop, phone, and iPad Mini.
- After a connected load, the application shell reopens offline on field devices.
- iOS offline reopening was specifically tested after correcting redirected-response caching in the service worker.
- No Customer File or downstream workspace functionality was built during Milestone 0.

## Milestone 1 scope

Milestone 1 is the **Customer File only**.

The Customer File is the central organizing object inside Toolbox. Toolbox is the file cabinet; a Customer File is the customer/job file. Later workspaces operate inside an already-open Customer File.

This milestone must establish the Customer File workflow and the minimum persistence needed to prove it reliably. It must not become an excuse to build Distress, Floor, Report Builder, Diagnostics, synchronization, or speculative future infrastructure early.

### In scope

- Customer File cabinet/list view sufficient to find and reopen a file.
- Create a new Customer File.
- Open an existing Customer File.
- Edit the shared customer/job information owned by the Customer File.
- Save that information reliably.
- Customer File identity persists across navigation, reload, close/reopen, and ordinary connectivity changes.
- A clear open-file context so later workspaces can inherit the Customer File without asking the investigator to select or recreate the customer.
- Responsive desktop/iPad/phone behavior.
- Offline behavior appropriate to the Customer File slice being built.
- Live deployment and real-device review.
- The minimum persistence architecture required for this milestone, chosen deliberately from the actual Customer File needs rather than from speculative future work.

### Shared context

The Customer File owns shared information described in `VISION.md`, including customer/job context such as property address, customer/homeowner/contact information, billing information where needed, general job information, plan/surface context, customer-level voice memos/interview information, and other genuinely shared job context.

**Not every possible shared field must be implemented in the first slice.** The first implementation should establish the Customer File model and workflow with the smallest useful set of fields, then expand deliberately within this milestone.

## Acceptance

Milestone 1 is complete when:

- A user can create a Customer File from the live Toolbox application.
- Saved Customer Files can be found and reopened.
- Shared information entered into a Customer File is not requested again merely because the user navigates within Toolbox.
- Information acknowledged as saved survives reload and close/reopen.
- The open Customer File is unmistakable to the investigator without wasting working canvas.
- The workflow is usable on desktop, iPad, and phone.
- The implemented Customer File behavior has been tested with loss/restoration of connectivity appropriate to this milestone.
- No Distress, Floor, Diagnostics, or Report Builder workflow has been implemented early.
- The actual diff has been reviewed against `VISION.md` and `AGENTS.md`.

## Out of scope

- Distress Survey integration or capture.
- Floor Survey integration or capture.
- Distress Edit.
- Multiple-surface Distress implementation.
- Floor Survey multiple-level implementation.
- Report Builder.
- Diagnostics.
- AI integration.
- Standalone import/recovery implementation.
- Full cloud synchronization unless the minimum Customer File persistence proof specifically requires a narrowly scoped piece of it.
- SaaS-style roles, billing, invitations, or enterprise administration.
- Speculative infrastructure for future workspaces.

## Important

Customer File is the first product workflow, not a generic database exercise.

Do not expose storage, synchronization, IDs, schemas, or other implementation machinery to the investigator. Do not ask for information Toolbox already knows. Keep the correct workflow obvious and preserve the canvas.

Before choosing persistence architecture, inspect the actual Customer File requirements and choose only what this milestone needs. A stated future need is not authorization to build future architecture now.
