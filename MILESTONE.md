# Milestone 0 — Live Foundation

## Purpose

Create the smallest real Toolbox foundation that is continuously deployed and inspectable on phone, iPad, and desktop before any product workflows are built.

## In scope

- Minimal application shell branded "Toolbox"
- Shared visual/CSS foundation sufficient for the shell
- Cloudflare deployment foundation
- PWA manifest
- Service worker / basic installability
- Home-screen icon support
- Responsive behavior for phone, iPad, desktop
- Continuous live deployment from `main`
- Basic offline shell loading
- Documentation/guardrails required to begin development

## Acceptance

- `main` branch deploys successfully.
- Toolbox opens from a real live URL.
- Product UI says "Toolbox," never "Toolbox V3."
- The same deployed application opens on desktop, iPad, and phone.
- Installable/home-screen PWA foundation works where supported.
- After at least one connected load, the basic application shell can reopen offline.
- Canvas-first responsive foundation does not waste mobile workspace.
- No Customer File functionality has been built yet.
- No Distress/Floor/Diagnostics/Report Builder functionality has been built yet.

## Out of scope

- Customer File
- Customer database
- Distress integration
- Floor integration
- Multiple-surface implementation
- Cloud job synchronization
- Report Builder
- Diagnostics
- AI integration
- Standalone import
- Speculative infrastructure for later milestones

## Important

Milestone 0 must stay tiny. Do not turn this into weeks of architecture or a giant design-system project.
