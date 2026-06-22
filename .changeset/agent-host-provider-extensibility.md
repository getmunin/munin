---
"@getmunin/backend-core": minor
"@getmunin/agent-runtime": minor
"@getmunin/agent-host": minor
"@getmunin/dashboard-pages": minor
---

Add host extensibility hooks for the agent runner and provider configuration:

- Rate-limit counters can be incremented by an arbitrary amount (`record(bucket, amount)`); add monthly `ai_tokens` and per-minute `ai_generates` buckets.
- The usage summary (`/v1/usage/summary`) reports monthly AI token usage, surfaced as a tile on the usage and overview pages.
- Agent passes can report a `quota_exceeded` skip outcome.
- The agent host accepts an optional provider factory, credential resolver, and pre-generate gate via `runnerOptions`. The gate is consulted for both live chat and scheduled background work (distinguished by a `trigger` argument), so a host can supply its own provider implementation and meter or limit usage per org without forking the runner.
- The provider picker accepts host-supplied presets — including a credential-less "managed" preset that renders host content and clears the org key on selection — plus a default selection. The AI settings and usage pages accept an optional content slot.
