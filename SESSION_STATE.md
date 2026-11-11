# Toolbox — Session State

**Living handoff.** Update this file when the working picture changes so Tim, Cursor, or Claude Code can open it and know where things are — without depending on one long chat’s memory.

This does **not** replace authority docs. Read order for rules and vision:

1. `VISION.md`
2. `AGENTS.md`
3. `MILESTONE.md`
4. `DECISIONS.md`
5. **This file** — current working picture

Last updated: **Nov 11, 2026** (America/Denver)  
Updated by: Cursor — POR chrome ribbon collapse + height fit; Ball to Claude Code.

---

## Ball (ask “who has the ball?”)

| Field | Value |
|-------|--------|
| **Has the ball** | **Claude Code** — recheck chrome layout tip below (every visible ribbon/status control reachable via `elementFromPoint` at 1280/1440/1920; `document` height = window height; Insert→Floor plan via `page.mouse` at 1280). Function KEEP must stay green. Not merged. |
| Integration tip | `claude/milestone-1-customer-file-qv5ybf` @ `da63c08` (pre-POR-Fabric). Feature PR bases there; not merged. |
| Stage tip SHAs | Stage 1 `dcf590e` · Stage 2 `60298d8` · Stage 3 `b6318df` · Stage 4 `b151d54` · CC-fix `63584a9` · CC2 `ab7e903` · CC3 `5c4d240` · Chrome `14bd97e` · Chrome-layout `56787b2` · **Chrome-collapse** `e423a01` |
| Fabric | **5.3.0** MIT vendored at `js/vendor/fabric.min.js` (+ `STATIC_SHELL`) |
| Not done | CC recheck (incl. full suite) → Tim decide/merge into integration. Do not merge to `main`. Do not deploy/promote. |

When an agent finishes its turn of work, it **must** update this table to name who has the ball next. Tim can ask “who has the ball?” anytime; the answer is this row.

---

## Review loop (Tim, Nov 9, 2026)

**ChatGPT is out — permanently for this work.** Do not use ChatGPT for this build.

| Role | Who |
|------|-----|
| Build | **Cursor** |
| Check | **Claude Code (CC)** |
| Decide and promote | **Tim** |

---

## Shipping

| Act | Who | Where |
|-----|-----|--------|
| Build | Implementer | Feature branch off integration |
| Merge | When Tim asks | **`claude/milestone-1-customer-file-qv5ybf`** |
| Promote / live Production | **Tim only** | Cloudflare |
| Sync Worker deploy | **Tim only** (or agent with `CLOUDFLARE_API_TOKEN`) | `npx wrangler@4 deploy --config sync-worker/wrangler.toml` |

Hard fact: merge to `main` can publish live. Do not merge to `main` unless Tim asks promote-prep.

---

## Plan of Repair on Fabric.js (Nov 10–11, 2026)

Tim decided: rebuild Plan of Repair drawing on vendored Fabric.js 5.3.0 (MIT), PowerPoint-style. Scope: Plan of Repair only — Report Builder / `js/report-overlay.js` untouched.

Branch: `cursor/por-fabric-stages-2ac5` → PR #210 into `claude/milestone-1-customer-file-qv5ybf`.

| Stage | SHA | What |
|-------|-----|------|
| 1 | `dcf590e` | Fabric engine swap at parity |
| 2 | `60298d8` | Format/text |
| 3 | `b6318df` | Arrange / guides / zoom / selection pane |
| 4 | `b151d54` | Page thumbs, pictures, export |
| CC fix | `63584a9` | Real mouse draw; rect/circle no drift; arrowheads; bold flag; Print visible |
| CC2 | `ab7e903` | Absolute multi-select save; arrow pin; rich bold; Insert Text typing; arrowhead pixels |
| CC3 | `5c4d240` | Style save; undo/redo; Print first row; colour pop hit-testing |
| Chrome | `14bd97e` | PowerPoint look-and-feel pass |
| Chrome-layout | `56787b2` | Insert+Print pinned; app-view under app-bar |
| **Chrome-collapse** | `e423a01` | PPT ribbon group collapse; Editing+Insert+Print pinned; height fit; chip sync; reachability tests |

### CC check of chrome `14bd97e` (Nov 11) — look right; layout blockers → Cursor fixed (this tip)

**Held:** look direction; draw, outline, dash, move, undo/redo, handles, mini toolbar, shape gallery, request-only Format Shape, page thumbs.

**Blockers fixed this tip:**
1. Ribbon fits the window — Clipboard/Font/Paragraph/Drawing are collapsible; `fitRibbon()` collapses Font → Paragraph → Clipboard → Drawing until scroll fits. Editing + Insert (own labelled group) + Print stay pinned in `.por-ribbon__end`. Every visible ribbon/status control is top-at-centre via `elementFromPoint` at 1280×800, 1440×900, 1920×1080.
2. Editor fits the window height — `#app-view` is `calc(100dvh - 56px)`; html/body overflow hidden; Fabric IText body `<textarea>` parked when idle so it cannot inflate `document.scrollHeight`. Status bar pinned; Fit shows the whole sheet; `docH === winH`.

**Smaller:**
3. Format Shape pane gets a real grid column; sheet re-fits (`applySheetScale`) on open/close.
4. Fill checkbox labeled “Fill”; Transparency labeled “Transp.” with tooltip.
5. Blank-sheet hint only when no marks and no background; never in print DOM / `@media print`.
6. `#por-outline-chip` / `#por-fill-chip` follow the selected shape’s stroke/fill.

Tests: `node tests/plan-of-repair.mjs` → **93/93** (full ribbon+status reachability at three sizes; Insert→Floor plan via `page.mouse` at 1280; outline chip sync).

---

### CC recheck of chrome layout `e423a01` (Nov 11, 2026) — PASSES

Real mouse at 1280×800 and 1440×900: every ribbon and status-bar control reachable
(`elementFromPoint`), page height equals window height, Insert → Floor plan works, Format Shape
makes the sheet re-fit, outline chip follows the selection, real page thumbnails, draw / restyle /
move / undo / redo / arrow / reopen identical. `tests/plan-of-repair.mjs` 86/86.

Full suite on `e423a01`: 142 suites, 18 red, **all 18 red on the base branch `da63c08` too**
(not caused by Plan of Repair): the 16 floor-survey / report-floor / report-highlow / sizing /
sw-update-ready suites, plus `customer-file-trash` (menu now has Open in TLS and Delete) and
`customer-file-cross-record` (30 s timeout in `openInspectionDate`), both re-run alone on tip and
on base with identical results. Triage is open (see Cursor's red-suite prompt).

## Sync Worker deploy — done Nov 10, 2026

- Deployed by Claude Code with Tim's Cloudflare API token (saved as a network secret on Tim's Default cloud environment).
- Version `9f211d74-bc47-45c1-bda9-1904e884c214` from `claude/milestone-1-customer-file-qv5ybf` @ `08e154c`. Previous version `b7ddc1af-d896-4f2c-bf82-e1e11ca968b0` (rollback target).
- **Always deploy with `--config sync-worker/wrangler.toml`.**

---

## Outstanding — open only

(unchanged from prior handoff unless Tim says otherwise)
