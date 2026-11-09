# Toolbox — Session State

**Living handoff.** Update this file when the working picture changes so Tim, Cursor, or Claude Code can open it and know where things are — without depending on one long chat’s memory.

This does **not** replace authority docs. Read order for rules and vision:

1. `VISION.md`
2. `AGENTS.md`
3. `MILESTONE.md`
4. `DECISIONS.md`
5. **This file** — current working picture

Last updated: **Nov 9, 2026** (America/Denver)  
Updated by: Claude Code — check of `1152eeb`: Cabinet rules work; report + video fixes needed; Ball to Cursor.

---

## Ball (ask “who has the ball?”)

| Field | Value |
|-------|--------|
| **Has the ball** | **Cursor** — fix Claude Code findings on `1152eeb` (Quick Capture / video Cabinet media): QC on report (untagged auto-placed; image not found; "Photo 00" labels), Download video missing, Worker video upload buffering, thumbnail fallback, stale import test. |
| Next | **Claude Code** rechecks, then **Tim** (merge). |
| Integration merge | Not yet. Open PR into `claude/milestone-1-customer-file-qv5ybf` (base `803abf9`). Do **not** merge until Tim says. |
| Not done | CC review → Tim merge to integration → Tim promote. |

When an agent finishes its turn of work, it **must** update this table to name who has the ball next. Tim can ask “who has the ball?” anytime; the answer is this row.

---

## Review loop (Tim, Nov 9, 2026)

**ChatGPT is out — permanently for this work.** Tim’s ChatGPT workspace/chat glitched and is not workable. Do not reopen that thread, hand it work, or wait on it.

| Role | Who |
|------|-----|
| Build | **Cursor** |
| Check | **Claude Code (CC)** |
| Decide and promote | **Tim** |

This is a **Cursor + Claude Code** build. Cursor builds; Claude Code independently reviews; Tim decides and promotes. No third voice.

---

## Who is working / which chat

| Role | Detail |
|------|--------|
| Product owner | Tim (`tappel003`) |
| Active Cursor thread | https://cursor.com/agents/bc-eddcce18-c57b-423f-b2f4-6f17f8662ac5 — “Toolbox V3 continued” |
| Claude Code | Independent check when the Ball says so |
| ChatGPT | **Dead path.** Workspace glitched; chat not workable. Do not use. |

Long chats cost more tokens and do **not** give the model continuous human-like memory. Durable facts belong here and in the authority docs.

---

## Shipping — same page for every agent

| Act | Who | Where |
|-----|-----|--------|
| Build | Implementer (agent) | Feature branch off the integration branch |
| Merge | Implementer, **only when Tim asks** | **`claude/milestone-1-customer-file-qv5ybf`** |
| Promote / live Production | **Tim only** | Cloudflare |

**Hard facts (do not re-litigate):**

- Integration branch name is fixed in `AGENTS.md` / `DECISIONS.md` (merged #196, tip includes `ff424f2`).
- Bot merge into `main` **can publish live** (verified Nov 5, 2026 — `toolbox-shell-v439` went live without Tim promoting). Treat merge-to-`main` as promote risk. Warn and stop if it would publish.
- Never deploy Sync Worker, change Access, or promote without Tim’s explicit go.
- Discussion is not a work order. “Go” / “do it” / “build it” = authorization. Describing UI is not authorization.
- Never tell Tim what to do with his time.
- When Tim says “Merge I promote,” that is merge to the **integration** branch only. Promote is still Tim. Prefer the agent Tim is talking to for the merge when that is clear; the merge itself is still valid if another authorized agent lands it on the right branch and Tim accepts the result.
- **Not the path (closed Nov 8, 2026):** GitHub protection so “bots cannot merge `main`.” Tim: that is not the correct path. Do not reopen it as outstanding work. The shipping table above is the path — merge to integration only; Tim promotes.

---

## Branch tips (as of last update)

| Branch | Tip (approx) | Notes |
|--------|----------------|-------|
| `claude/milestone-1-customer-file-qv5ybf` | `803abf9` | **Integration tip** (includes #204 + SESSION_STATE #206). Shell `v449` on tip; this PR bumps to `v450`. |
| `cursor/qc-cabinet-media-2ac5` | (this PR) | Quick Capture + Job Walk video live in File Cabinet, not on Check Out. |
| `main` | re-check | Behind milestone. Do not merge here unless Tim asks promote-prep. |

Always re-check with `git fetch` before claiming tip SHAs.

---

## Recently finished (code on integration branch unless noted)

| Item | State |
|------|--------|
| Floor open seed: prefer book `reportBuilder.floorLayout`; legacy slide `meta.layout` only if book absent | Done — #194 on milestone. Also on `main` via #193 (that merge published). |
| Share lookbook = **link only** (no ZIP download) | Done on milestone |
| RB toolbar regroup: format \| Fit+Present \| Draft/Print/Share/Export | Done on milestone |
| Plan of Repair as RB-style drawing template | On milestone |
| On-this-device ••• Delete gate | Done — #198 |
| Library / home card address on two lines | Done — #199 |
| POR Paint/PPT toolbar + view-pan fix | Done on integration via #204. Shell `v449` (with Job Walk media). |
| Job Walk media (delete photo/audio; Take Video + Delete; Sync `vid_`) | Done on integration via #205 → TLS → #204. |
| TLS workspace integrated build | Done — #204 @ `7f778d6` / tip `803abf9`. |
| **QC + Job Walk video → File Cabinet (not Check Out)** | **Built on `cursor/qc-cabinet-media-2ac5` — awaiting CC.** Decisions 1–6 in `DECISIONS.md` (Tim Nov 9). Shell `v450`. |

---

## Outstanding — real open work

1. **CC check then Tim merge** of `cursor/qc-cabinet-media-2ac5` into integration. Do not merge to `main`.

2. **Open product items (safer defaults shipped; Tim has not decided):**
   - After a video uploads: **keep** the clip on the phone (default) vs clear to free space.
   - Job Walk **audio** notes: still travel with the file like typed notes (default) vs treat like photos/video.

3. **Promote** — Tim only. Live Production does not get this until Tim promotes after integration merge.

4. **Cloudflare Access path bypass for `lookbook/*`** on `sync.sandiageotoolbox.com` — Tim’s ops action.

5. **Confirm Sync Worker deploy** has lookbook create routes if Share still 404s.

6. **Stale / unrelated open PRs** — triage when Tim wants; not blockers.

---

## How any new agent (Cursor / Claude Code) should start

1. Read `VISION.md` → `AGENTS.md` → `MILESTONE.md` → `DECISIONS.md` → **`SESSION_STATE.md`**.
2. `git fetch origin claude/milestone-1-customer-file-qv5ybf` and branch from that tip.
3. Open PRs with **base = `claude/milestone-1-customer-file-qv5ybf`**. Merge there when Tim asks. Do **not** promote. Do **not** merge to `main` unless Tim explicitly asked for promote-prep **and** you warned about publish risk.
4. Do not scrap lookbook. Finish Access bypass (Tim) + confirm Worker if Share 404s.
5. After meaningful progress, **update this file** (date, tips, done/outstanding, Ball) in the same PR or a small follow-up — so the next handoff stays true.

---

## Update checklist (when you change this file)

- [x] Date / timezone label  
- [x] Ball table  
- [x] Integration + `main` tip SHAs (after fetch)  
- [x] Done vs outstanding still accurate  
- [x] Lookbook / Access / Worker status  
- [x] Any new “do not repeat” process lesson Tim just enforced  
