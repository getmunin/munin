---
'@getmunin/agent-runtime': patch
'@getmunin/agent-host': patch
---

Retry provider 429s with jittered backoff, and stagger curator drains across orgs

A hosted deploy put every org's agent runner on one shared provider key and one shared per-minute token budget. When the backend container respawned, all runners reconnected to the realtime bus inside the same second and each immediately drained its curator queue. Individual curator jobs cost 15k–85k tokens, so a handful of concurrent drains blew straight through the provider's tokens-per-minute quota and came back `429 INSUFFICIENT QUOTA`.

Two things then made a one-second burst look like an outage. `openAiCompatibleProvider` surfaced the first 429 as a `ProviderError`, and `AgentHealthService` opened an `llm_provider` alert on it — which only resolves on a later *success*, so the dashboard's "agent runner offline — provider rate limit hit" banner stayed up for hours after the provider had recovered. Four orgs sat degraded that way with no further failing traffic.

`openAiCompatibleProvider` now retries a 429 up to four times before raising, waiting `500ms · 2^attempt` (capped at 15s), never less than a `Retry-After` header asks for, and multiplied by a random 1–2× jitter so concurrent callers don't retry in lockstep. Every caller inherits this: chat, curator jobs, and any host-supplied provider that wraps the built-in one. Other statuses are untouched — a 401 or 404 still fails on the first attempt, since retrying a bad key or a missing model only delays the real signal.

`AgentHostRunner` now routes the on-connect curator drain through a shared scheduler that spaces drains 5s apart, so a twelve-org boot spreads over a minute instead of firing at `t=0`. A single reconnect after the spacing window has passed is not delayed at all, and a runner that stops with a drain still pending cancels it.
