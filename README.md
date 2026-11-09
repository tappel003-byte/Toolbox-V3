# Toolbox

Internal professional field-investigation and reporting system. The product is **Toolbox** — "V3" names this repository/development generation only, not the product itself.

This repository is a clean rebuild. It does not inherit Toolbox-V2's architecture.

## Documents (authority order)

1. **`VISION.md`** — product authority. Durable product vision and principles. If code or a milestone conflicts with it, VISION.md wins unless the product owner explicitly changes it.
2. **`AGENTS.md`** — implementation guardrails for anyone (human or AI) working in this repository.
3. **`MILESTONE.md`** — the current, and only currently allowed, unit of work.
4. **`DECISIONS.md`** — durable decision log.
5. **`SESSION_STATE.md`** — living handoff for **Cursor and Claude Code**: who has the Ball, which tip is current, what is done, what is open. Update it when the picture changes.

Supporting (not authority):

- **`TODO.md`** — parked work Tim asked to hold. Not approved to build.
- **`docs/tls-build-and-review-brief.md`** — TLS integrated-build brief.
- **`DESIGN_PRINCIPLE.md`** — locked governing principle wording for chrome.

## Who builds

**Cursor builds. Claude Code (CC) independently checks. Tim decides and promotes.** ChatGPT is out of the active loop. Day-to-day agent communication is through `SESSION_STATE.md`, not a third chat.

## References, not architecture

- **Toolbox-V2** is evidence and reference only — proven work and lessons to draw on, not the architecture V3 is built around.
- **field-reporter-pro** (standalone Distress Survey) and **floorplan-topo-maker** (standalone Floor Survey) are permanent, untouched field fallbacks — reference implementations of proven field behavior, not something this repository modifies.
