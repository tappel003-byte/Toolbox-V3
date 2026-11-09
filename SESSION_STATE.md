# Toolbox — Session State

**Living handoff for Cursor ↔ Claude Code.** Keep this file short. Ball, current tips, what’s open now, and any fresh process lesson. Do not grow a history log here — durable product rules stay in `VISION.md` / `DECISIONS.md`; finished work lives in git.

Authority order: `VISION.md` → `AGENTS.md` → `MILESTONE.md` → `DECISIONS.md` → **this file**.

Last updated: **Nov 9, 2026** (America/Denver)  
Updated by: Claude Code — reviewed #207 @ `4cbe0fb`: docs OK, no dangling links; “Open now” is missing three open items; Ball to Cursor.

---

## Ball (ask “who has the ball?”)

| Field | Value |
|-------|--------|
| **Has the ball** | **Cursor** — add the missing open items to “Open now” in this PR (CC review of #207 @ `4cbe0fb`). |
| Next | **Claude Code** quick recheck, then **Tim** (merge #207). |
| Integration tip | `claude/milestone-1-customer-file-qv5ybf` @ `803abf9` (#204 TLS on tip; shell `v449`) |
| This PR tip | `cursor/docs-cleanup-2ac5` — remove stale council/log/RB audits; slim SS; Cursor↔CC via this file |
| Do not merge to `main` | until Tim asks promote-prep |

When an agent finishes its turn, **update this table** to name who has the ball next.

---

## How we talk (Tim, Nov 9, 2026)

| Role | Who |
|------|-----|
| Build | **Cursor** |
| Check | **Claude Code (CC)** |
| Decide / promote | **Tim** |
| Agent-to-agent handoff | **`SESSION_STATE.md` (this file)** |

ChatGPT is out (workspace unusable). No multi-model council docs.

**Keep this file slim:** after a merge lands, drop finished rows. Open work only. One Ball table. Re-fetch before claiming tip SHAs.

---

## Open now

1. **PR #207 docs cleanup** — CC review, then Tim merges to integration. Removes POR council, AI-REVIEW-LOG, old RB audit/plan files; points AGENTS/README at this handoff.
2. **Promote** — Tim only. Integration has #204; live Production waits on Tim. Not on `main`.
3. **Lookbook Access bypass** for `lookbook/*` on `sync.sandiageotoolbox.com` (Tim ops). Create/upload/finalize stay gated.
4. **Confirm Sync Worker** has lookbook create routes if Share still 404s (`wrangler deploy` when Tim authorizes).

---

## Start here (any new agent)

1. Read Vision → Agents → Milestone → Decisions → **this file**.
2. Branch off `claude/milestone-1-customer-file-qv5ybf`.
3. PRs base = that integration branch. Merge only when Tim asks. Never promote. Never merge to `main` without Tim’s promote-prep + publish warning.
4. Update **Ball + Open now** when you finish a turn.
