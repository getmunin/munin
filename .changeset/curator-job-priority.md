---
"@getmunin/types": minor
"@getmunin/db": minor
"@getmunin/backend-core": minor
"@getmunin/agent-runtime": minor
---

Prioritize interactive onboarding work over background curator jobs. Curator jobs now carry a `priority` (default `0`), and the claim path orders by `priority DESC, next_attempt_at ASC` so a user-initiated website import (`task://web/scrape-website`, priority `100`) is claimed ahead of a backlog of older scheduled `skill://` sweeps instead of waiting behind them. Priority is derived centrally via `priorityFor(uri)` and can be overridden per-enqueue; a partial index keeps the claim path index-served.
