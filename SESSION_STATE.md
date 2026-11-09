# Toolbox — Session State

**Living handoff.** Update this file when the working picture changes so Tim, Cursor, or Claude Code can open it and know where things are — without depending on one long chat’s memory.

This does **not** replace authority docs. Read order for rules and vision:

1. `VISION.md`
2. `AGENTS.md`
3. `MILESTONE.md`
4. `DECISIONS.md`
5. **This file** — current working picture

Last updated: **Nov 9, 2026** (America/Denver)  
Updated by: Cursor agent — Tim: ChatGPT workspace unusable; build loop is Cursor + Claude Code only.

---

## Ball (ask “who has the ball?”)

| Field | Value |
|-------|--------|
| **Has the ball** | **Tim** |
| Job Walk media | **Merged** — PR #205 into `cursor/tls-workspace-2ac5` @ `2b3f788` (Tim’s check + merge). Shell `v449`. |
| POR / TLS → integration | PR #204 still open on `cursor/tls-workspace-2ac5` → `claude/milestone-1-customer-file-qv5ybf`. Not merged to integration; not promoted. |
| Branch / tip | `cursor/tls-workspace-2ac5` @ `6ef7679` — POR Paint/PPT + Job Walk media |
| Do not merge to integration / `main` | until Tim says so |

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
| `claude/milestone-1-customer-file-qv5ybf` | `ec1b55e` | **Integration tip.** Re-check with fetch before claiming. |
| `cursor/tls-workspace-2ac5` | `6ef7679` | TLS + POR Paint/PPT + Job Walk media (#205). Shell `v449`. PR #204 → integration. |
| `main` | re-check | Behind milestone on several merges. |

Always re-check with `git fetch` before claiming tip SHAs.

---

## Recently finished (code on integration branch unless noted)

| Item | State |
|------|--------|
| Floor open seed: prefer book `reportBuilder.floorLayout`; legacy slide `meta.layout` only if book absent | Done — #194 on milestone. Also on `main` via #193 (that merge published). |
| Verification: both / legacy-only / neither; H/L offsets unchanged | Passed (`tests/report-floor-legacy-vs-book.mjs`) |
| Share lookbook = **link only** (no ZIP download) | Done on milestone |
| RB toolbar regroup: format \| Fit+Present \| Draft/Print/Share/Export | Done on milestone |
| Plan of Repair as RB-style drawing template | On milestone; earlier bring-to-main for promote |
| Engineer lookbook packager + Worker routes in repo | In tree; floor sheet capture fix #195 on milestone |
| Lookbook product intent | **Keep it.** Tim does not think it’s a bad idea. Gap is ops/Access, not the idea. |
| On-this-device ••• Delete gate | Done — #198. No DS pin-photos and no FS points → local Delete on •••; otherwise Explorer note. Floor plan alone does not block. Was shell `v441`; tip now `v442`. |
| Library / home card address on two lines | Done — #199 (`1e786f8`, merge `f055fed`). Street on line 1; city/state/ZIP on line 2 (envelope style). Display only — does not rewrite `propertyAddress`. Shell `toolbox-shell-v442`. Built by Claude Code; Tim accepted (“good”); Cursor repairing this handoff. |
| POR Paint/PPT toolbar + view-pan fix | On `cursor/tls-workspace-2ac5` — Claude technical pass; Tim look check. Shell `v448`. |

---

## Outstanding — real open work

1. **Job Walk media repair** — **Done on TLS branch.** PR #205 merged into `cursor/tls-workspace-2ac5` (`2b3f788`). Delete photo/audio; Take Video + Delete; Sync `vid_`; shell `v449`.

2. **TLS workspace → integration** — PR #204 still open (`cursor/tls-workspace-2ac5` → milestone). Includes POR Paint/PPT + now Job Walk media. Do **not** merge to integration / promote until Tim says so.

3. **Cloudflare Access path bypass for `lookbook/*`** on `sync.sandiageotoolbox.com`  
   - Without this, engineer (and private-window) opens hit Cloudflare login.  
   - Tim’s ops action.  
   - Create/upload/finalize stay Access-gated; only public GET needs the bypass.

4. **Confirm Sync Worker deploy has lookbook create routes**  
   - If Share still shows **“Not found”**, `POST /lookbook` is not on the live Worker.  
   - Deploy (when Tim authorizes / from an authenticated machine):  
     `npx wrangler@4 deploy --config sync-worker/wrangler.toml`  
   - Runtime secrets attach when an agent **starts**. An already-running VM may not see `CLOUDFLARE_API_TOKEN` even when it is set in Cursor Secrets.

5. **Stale / unrelated open PRs** (don’t confuse with current tip)  
   - #165 older promote-rules docs (intent largely covered by #196)  
   - #151, #139, #120, and older main-based #97 / #86 / #85  
   - Triage when Tim wants; not blockers for lookbook Access.

---

## How any new agent (Cursor / Claude Code) should start

1. Read `VISION.md` → `AGENTS.md` → `MILESTONE.md` → `DECISIONS.md` → **`SESSION_STATE.md`**.
2. `git fetch origin claude/milestone-1-customer-file-qv5ybf` and branch from that tip.
3. Open PRs with **base = `claude/milestone-1-customer-file-qv5ybf`**. Merge there when Tim asks. Do **not** promote. Do **not** merge to `main` unless Tim explicitly asked for promote-prep **and** you warned about publish risk.
4. Do not scrap lookbook. Finish Access bypass (Tim) + confirm Worker if Share 404s.
5. After meaningful progress, **update this file** (date, tips, done/outstanding, Ball) in the same PR or a small follow-up — so the next handoff stays true.

---

## Update checklist (when you change this file)

- [ ] Date / timezone label  
- [ ] Ball table  
- [ ] Integration + `main` tip SHAs (after fetch)  
- [ ] Done vs outstanding still accurate  
- [ ] Lookbook / Access / Worker status  
- [ ] Any new “do not repeat” process lesson Tim just enforced  
