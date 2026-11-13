# Toolbox — Session State

**Living handoff.** Update this file when the working picture changes so Tim, Cursor, or Claude Code can open it and know where things are — without depending on one long chat’s memory.

This does **not** replace authority docs. Read order for rules and vision:

1. `VISION.md`
2. `AGENTS.md`
3. `MILESTONE.md`
4. `DECISIONS.md`
5. **This file** — current working picture

Last updated: **Nov 12, 2026** (America/Denver)  
Updated by: Cursor — editable visit notes. Ball → Tim (promote).

---

## Ball (ask “who has the ball?”)

| Field | Value |
|-------|--------|
| **Has the ball** | **Tim** — pill gestures + survey date + Plan of Repair work by Claude Code on `claude/por-draw-contour-2ac5`. Ready to merge into integration when Tim asks. Not on `main`. |
| Integration tip | `ecaea0a` (`ecaea0a85db9cfd2a25683a34939621bc068a3cb`) — editable visit notes; shell v472 |
| Stage tip SHAs | Stage 1 `dcf590e` · Stage 2 `60298d8` · Stage 3 `b6318df` · Stage 4 `b151d54` · CC-fix `63584a9` · CC2 `ab7e903` · CC3 `5c4d240` · Chrome `14bd97e` · Chrome-layout `56787b2` · **Chrome-collapse** `e423a01` |
| Fabric | **5.3.0** MIT vendored at `js/vendor/fabric.min.js` (+ `STATIC_SHELL`) |
| Shell | `toolbox-shell-v472` |
| Not done | Do not merge to `main` unless Tim promotes. Do not deploy Sync Worker. **Do not strip POR or Report Builder controls or icons.** |

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

Merged: `cursor/por-fabric-stages-2ac5` → integration (Nov 11).

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

### CC recheck of chrome layout `e423a01` (Nov 11, 2026) — PASSES

Real mouse at 1280×800 and 1440×900: every ribbon and status-bar control reachable. `tests/plan-of-repair.mjs` green on that tip.

---

## Initial Visit (Nov 11, 2026)

Authorized by Tim: "do the thing we added to the to-do list today." Merged into integration this turn (`cursor/initial-visit-2ac5`).

- Same Customer File container with `status: 'visit'` (absent on ordinary files).
- Home `+ Initial Visit` → name/phone/address → visit card (`js/job-walk.js` UI renamed).
- Visits lists: device heading, File Cabinet group, File Explorer Visits folder.
- Make Customer File: MOVE same id; landing floor / distress / home from outcomes.
- Offline: SW mirrors `/` as well as `/index.html` (PWA `start_url`); shell `v461` after merge.
- Tests: `tests/initial-visit.mjs`.

**Offline root cause (Nov 10 Job Walk):** PWA `start_url` is `/`, but the shell only cached `/index.html`. Cold offline open of `/` waited on network-first navigate and had no `/` cache mirror, so the yard open failed even though `js/job-walk.js` was in `STATIC_SHELL`.

**CC found four small defects (cleared):** button order, phone on card, Visits heading gap, offline stub wording.

**IV panel order (Nov 11, Tim — done on tip):** Schedule → Visit Notes → Take Photos / Videos / record → Outcome + Make Customer File at bottom.

**Schedule reminder (Nov 11, Tim — done on tip):** Visits are also appointments. Create + visit card have Date and Time; Visits list shows calendar/clock for the scheduled slot (not `updatedAt`). Editable anytime on the visit. Initial Visit tile removed from TLS Customer File home — Visits live on Toolbox home only.

**Phone Visits schedule (Nov 11, Tim — on tip):** Schedule under the address in `.cabinet-row__main` (meta stays hidden on phone).

**CC-check fixes (Nov 11, Tim authorized — on tip `089869b` / shell v466):**
1. Home buttons at 390: **+ New Customer File** → **+ Initial Visit** → **Import**.
2. Visits list schedule visible on phone (main column).
3. Visit card shows phone (`tel:`) + address read-only above Schedule.
4. POR tall PPT-style ribbon + Fluent icons vendored (`icons/fluent`, `js/vendor/fluent-icons.js`); Font never collapses at 1280/1440; docked shapes gallery + Shape Fill/Outline/Effects; Fill + Transp. labelled. **Nothing stripped.** Remaining visual gaps listed in `/opt/cursor/artifacts/por-remaining-differences.md` on the agent run.

**POR / PowerPoint chrome + icons (Nov 11, Tim — on tip, needs CC eye):** Plan of Repair ribbon cool-gray Office look + Fluent/PPT-style icon glyphs (Fill drip, Outline bar, Arrange orange/tan). **No controls removed. Report Builder untouched.** Tim’s rule: match PowerPoint look/feel; **add** Shape Format capabilities he named; **never strip** existing icons or functionality. An earlier agent pass that narrowed/stripped from a “scope honesty” aside was wrong and was reverted — that must not happen again.

### Working agreement with Tim (Nov 11, 2026) — read before acting

1. Tim sees work only when it is on **`claude/milestone-1-customer-file-qv5ybf`** (Workers Builds → he promotes). Feature-branch-only work is invisible to him.
2. “I need you to…” / “go” / “merge it” = build or merge. Design talk (“I think…”, “understood”, “let’s talk”) = words only until he says go.
3. PowerPoint screenshots = **target look** and **capabilities to add**. They are not permission to delete Report Builder or POR controls.
4. Clear short orders beat long scope essays. If unsure, **stop and ask** — do not invent cuts.
5. ChatGPT is out. Cursor builds; Claude Code checks; Tim decides and promotes.

---

## Claude Code — pasteable check prompt (Nov 11, 2026)

```
Toolbox-V3 — Claude Code check (Tim, Nov 11, 2026)

Read VISION.md → AGENTS.md → MILESTONE.md → DECISIONS.md → SESSION_STATE.md.
Work from integration tip of claude/milestone-1-customer-file-qv5ybf (shell toolbox-shell-v465, tip f6510f5).
Do NOT merge to main. Do NOT deploy Sync Worker. Do NOT promote. Do NOT strip any Plan of Repair or Report Builder controls or icons.

What landed for Tim to look at (Cursor today):
1) Initial Visit as scheduling: date+time on create and visit card; Visits list shows calendar/clock for the scheduled slot (not updatedAt); editable on the visit; Initial Visit removed from TLS Customer File home. **Phone fix:** schedule is under the address in main (not meta), so iPhone Visits cards show date/time.
2) Initial Visit panel order: Schedule → Visit Notes → Take Photos / Videos → Outcome + Make Customer File at bottom.
3) Plan of Repair: PowerPoint-equivalent icon glyphs + cool-gray ribbon chrome. Same buttons/menus as before — visual match only. Report Builder not touched.

Earlier mistake (do not repeat): an agent treated Tim’s “honest about scope / maybe we don’t need all shapes” talk as license to strip or narrow POR/Report Builder. Tim corrected: he wants PowerPoint look AND those Shape Format capabilities added (Arrange forward/back, Selection Pane, rotate, text box, more shapes as needed). Never remove existing functionality.

Your job — CHECK, not redesign:
A) On a phone-width viewport, open an Initial Visit and confirm panel order and schedule date/time + Visits list reminder.
B) Open Plan of Repair on desktop and compare chrome/icons to Tim’s PowerPoint screenshots (Shape Format ribbon, context mini Style/Fill/Outline, Arrange). Say what matches and what still does not — specifically, without removing anything.
C) Run tests/initial-visit.mjs and tests/plan-of-repair.mjs; report pass/fail.
D) Update SESSION_STATE.md: Ball → Tim (or Cursor if a concrete fix is authorized). List exact findings. Commit on a branch off integration; Tim merges when he asks.

If Tim later authorizes icon/capability fixes from your findings: add or restyle only — never strip.
```

---

## Clear-red suites A (Nov 11, 2026)

Merged `cursor/clear-red-suites-2ac5` into integration this turn. Triage A clears: `tests/customer-file-trash.mjs` + `tests/customer-file-cross-record.mjs` (Floor Survey path). CC checked the A tip; remaining 16 red suites are still open (floor-survey / report-floor / report-highlow / sizing / sw-update-ready).

---

### Claude Code: Plan of Repair ribbon polish (Nov 12, 2026) — branch `claude/por-ribbon-polish-2ac5`

Look only; nothing removed. Fixes the five defects in the CC re-check of `089869b`:
1. Shape Fill / Outline / Effects no longer overlap: the mini-toolbar rule `.por-picker__btn--shape`
   (column, 36px) was also hitting the ribbon's labelled buttons. Now one row each, with a colour chip.
2. Shapes gallery is 6 columns x 2 rows, every shape visible inside its box, clear of Arrange.
3. At 1440 wide nothing collapses (Paragraph stays open). At 1366 only Paragraph collapses.
4. Collapsed groups at 1280 show icon + name + chevron instead of a bare word over an empty band.
5. Draw / Design / View / File tabs are still greyed placeholders: left for Tim to decide (hide or build).
Shell `v469`. `tests/plan-of-repair.mjs` 96/96 (3 new layout checks). Fluent icons ARE vendored
(`js/vendor/fluent-icons.js`); CC's earlier note that they were not was wrong.
Stale test, not mine: `tests/tls-workspace-smoke.mjs` still clicks the Job Walk tile that Initial Visit
removed from the TLS home; it fails on the integration tip.

### Claude Code: Plan of Repair draw fixes + Contour toggle (Nov 12, 2026) — branch `claude/por-draw-contour-2ac5`

Built at Tim's go ("go, continue building all three"). Branch = ribbon polish + integration tip `d485948` + this work; shell **v472**.
1. **Draw tools no longer swallow drags.** A shape tool armed (line, arrow, rect, rounded rect, oval, triangle)
   sets `canvas.skipTargetFind`, so a drag always draws and the selected shape's handles cannot grab it.
   20 dots 22 px apart now draw 20 of 20 (was 10); a square around the dot just drawn is created (was 0).
2. **Bare click drops a default shape** centred on the click: dot 1.4 %, square 4 %, rectangle 6x4 %, line/arrow 8 % of the sheet.
3. **Contour toggle** (ribbon, Insert group): floor plan stays the base; Contour on puts the level's contour under it,
   plan multiplied over it, same extent, marks on top, also in each detail view and in Print / PDF. Saved as
   `page.background.contourOn` on a floor-plan page. Disabled when the page is not a floor plan or the level has no contour.
   The Insert menu's Floor plan / Contour choices are unchanged.
`tests/plan-of-repair.mjs` was 105/105 at first build (9 new checks, real mouse). Ribbon still fits at 1440 with nothing collapsed
(icon buttons 32 -> 29 px, Contour button added). One suite fixture has a deliberately missing import, so Print asks to
confirm; the new print check accepts it.
Follow-up on the three loose ends (Tim: "fix the rest of those three issues"):
- **Tabs:** File / Draw / Design / View were greyed placeholders with nothing behind them. They are now hidden (still in the markup,
  `hidden`), so the tab row shows Home and Insert only. Build them out when there is something to put there (View could hold
  zoom / grid / rulers, File could hold Print / Save).
- **Arrow-key nudge:** checked with real keys and waited for the debounced autosave: 0.24 % (4 px) per press, 0.98 % (16 px) with
  Shift. It was my probe reading before the save landed, not a bug. Now a test.
- **`tests/tls-workspace-smoke.mjs`:** updated for Initial Visit (Job Walk no longer exists as a TLS tile). It now checks there is no
  Job Walk / Initial Visit tile on the TLS home, reaches the same capture screen by route, and checks it is titled Initial Visit. 35/35.
`tests/plan-of-repair.mjs` now **108/108**.

### Claude Code: H/L/Δ pill gestures + survey date (Nov 12, 2026) — same branch `claude/por-draw-contour-2ac5`

Tim: "go, fix the pill and add the survey date ... I'm working on a report and I need the date in it."
- **Pill / Legend (`js/report-builder.js`):** reproduced with a real mouse first (slow press opened the −/+ box and killed the drag; plain
  click did nothing; zoomed slide would not move it). Now: mouse/pen drag moves at once, a plain click opens the −/+ box and a second click
  closes it, touch keeps press-and-hold, and both move while zoomed. `tests/report-pill-gesture.mjs` 16/16 (was 9/16).
- **Survey date (Floor Survey source `floor-survey/src`, bundle rebuilt into `js/floor-survey/`):** ⋯ → **Survey date** is the first item in
  every mode (value or amber "not set", date field + Today); amber dot on ⋯ while empty; slim "Survey date not set" bar once the first point
  is down, until a date is set; nothing sets today silently; typed dates commit when typing pauses. The report title block reads it live
  (checked: "SURVEY DATE September 30, 2026"). `tests/survey-date-menu.mjs` 12/12. Recorded in `DECISIONS.md` as the capture-app rules require.
  A rebuild of the unmodified source reproduced the committed bundle byte for byte before I changed anything.
- **Not changed:** the "Inspection date" control on Boundary & exclusions; `tests/floor-survey-date.mjs` still 10/11 (its reopen check
  looks for that control on a screen that no longer shows it once a boundary exists; the new ⋯ item is the way in after the fact).
- **Next for Tim:** merge into integration when asked. Customer Files list ••• could also get a "Survey date" item (not built).

### Claude Code: Customer File editor saved into the wrong file (found Nov 12, fixed Nov 13, 2026)

Tim: opened Jim Thomas 294, then typed a new file's contact information; "VCA Town and Country Animal Hospital" appeared on a file that
carried the Thomas plan and 7 pins. Cause (reproduced with a real mouse, also on the week-old `main`): `renderFileEdit` added an `input`
listener to the shared `app-view` container and never removed it. An editor that had been left kept reading whichever Edit customer form
was on screen and saved it, with its own stale copy of the file, into its own record. Result: contact fields overwritten, and newer
pins / survey points reverted to the stale copy (12 pins -> 3, 6 survey points -> 0 in the test).
Fix (`js/app.js`): `render()` first winds up the view being left (`registerViewCleanup` / `runViewCleanup`); the editor saves what is
typed and not yet saved (the form is read synchronously, while it is still on screen), then is `disposed`: it removes its listener,
clears its timer, and `scheduleSave` / `flushSave` do nothing. The input handler also ignores any field that is not inside its own form.
Shell v475. `tests/edit-listener-isolation.mjs` **11/11** with the fix, **3/11** on the integration tip without it.
Known limit: a plan still being processed when the editor is left by browser Back (not the Back / Done buttons, which wait for it) is not
saved afterwards; a late save from a left editor is the bug itself. Not built: a screen to restore an earlier Cabinet version of a part.

### Claude Code: new-file save rule + Personal | Business (Nov 13, 2026) — branch `claude/customer-type-2ac5`

Tim: blank "New Customer File" entries were piling up in the Cabinet (tapping New saved a blank file, mirrored 1.2 s later); asked for
Personal | Business with a company, a contact person and a title. See `DECISIONS.md` ("New Customer File saves only once it names the job").
`js/app.js` (switch, save rule, `displayName` / `contactLine`, list row), `js/sync.js` (customer component fields, Cabinet title),
`js/ai-export.js`, `js/job-walk.js`, `js/plan-of-repair.js`, `js/report-source.js`, `js/report-builder.js` (`residenceTitle`), `css/styles.css`.
Shell v476. Tests: `customer-type-and-new-file` 22/22, `sync-client-through-worker` 54/54, `edit-listener-isolation` 11/11.
Not done: `sync-worker/src/job-text.js` does not read the contact title (needs a Worker deploy, which was not made).

## Sync Worker deploy — done Nov 10, 2026

- Deployed by Claude Code with Tim's Cloudflare API token (saved as a network secret on Tim's Default cloud environment).
- Version `9f211d74-bc47-45c1-bda9-1904e884c214` from `claude/milestone-1-customer-file-qv5ybf` @ `08e154c`. Previous version `b7ddc1af-d896-4f2c-bf82-e1e11ca968b0` (rollback target).
- **Always deploy with `--config sync-worker/wrangler.toml`.**

---

## Outstanding — open only

1. **Claude Code re-check** of tip `v466` /  — IV phone order/schedule/contact + POR Fluent ribbon vs Tim’s screenshots (remaining diffs noted in agent artifacts).
2. **Initial Visit CC polish** — all four cleared (button order, phone on card, Visits heading gap, offline stub wording).
3. **POR Shape Format capabilities** — continue adding what Tim named from remaining diffs (never strip).
4. **Red suites** — 16 remaining (floor-survey / report-floor / report-highlow / sizing / sw-update-ready).
5. **Sync Worker** — Tim's browser check of `/health` + one Sync Now.
6. **App promote** — Tim only. Not `main` unless Tim asks promote-prep.
7. **Open against `main` (not merged):** #97 / #86 / #85 — leave until Tim asks promote-prep.

---

## How any new agent should start

1. Read `VISION.md` → `AGENTS.md` → `MILESTONE.md` → `DECISIONS.md` → **`SESSION_STATE.md`**.
2. Branch from `claude/milestone-1-customer-file-qv5ybf`.
3. PRs base = that branch. Merge there when Tim asks. Do not promote. Do not deploy Sync Worker without Tim’s go.
