---
'@getmunin/types': patch
'@getmunin/agent-host': patch
---

Reduce curator token usage: tighter per-skill tool allowlists and a lower iteration cap.

- **Tighter tool allowlists.** `TOOL_PREFIXES_BY_URI` in the job catalog gated each curator skill by broad module prefixes (`conv_`, `kb_`, `crm_`, `outreach_`), which loaded 10–30 tool schemas into the model context on every turn of the tool loop — re-sent on each iteration. Each scheduled/event-driven skill now allowlists only the exact tools its procedure actually calls (e.g. `set-topic-and-title` drops from all `conv_*` to 5 tools; `clean-contact-data` drops the unused `conv_` prefix entirely; `review-stale-entries` drops every mutating `cms_*` tool, enforcing its propose-only invariant at the runtime layer). Behavior is unchanged — the dropped tools were either operator-review-loop tools or ones the skills never call.
- **Lower iteration cap.** Curator skill passes now stop after `CURATOR_MAX_TOOL_ITERATIONS` (16) tool-loop iterations instead of 24. Since the full prompt prefix is re-sent on every iteration, this clips the worst-case per-job token spend; batch sweeps that don't finish in one pass resume on the next scheduled run (dedupe keeps them idempotent).
