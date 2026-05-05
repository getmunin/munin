# agent-sidecar

Optional sidecar for a self-hosted Munin. Two jobs in one process:

1. **Conversational replies** — subscribes to the realtime gateway, dispatches end-user messages to the LLM via the self-service MCP surface.
2. **Curator queue worker** — drains the backend's `curator_jobs` queue. KB curation jobs are enqueued by `conv.service` on every `conversation.handover_resolved` (per-conversation, deduped by message id). Scheduled sweeps (KB safety-net, CRM hygiene, CMS stale-content) are enqueued by the backend's `@nestjs/schedule` cron jobs. Either way, the sidecar's worker claims them via `SELECT ... FOR UPDATE SKIP LOCKED`, runs `runSkillPass`, and acks/fails.

The conversational reply path is the original "self-service AI" runner. The curator worker path used to live in the cloud `@munin-cloud/curator-runner` package; it's now bundled here so OSS self-hosters get the whole flow in one process.

```
            ┌────────────────────────────────────────────┐
            │           munin backend                    │
            │  /api/realtime  /api/conversations  /mcp   │
            └────────────────────────────────────────────┘
                 ▲          ▲          ▲          ▲
                 │          │          │          │
   admin Bearer  │ events   │ REST     │ admin    │ delegated
   (subscribe)   │          │ history  │ MCP      │ end-user MCP
                 │          │ + reply  │ (prompts │ (per turn,
                 │          │          │  + skill │  audience=
                 │          │          │  reads)  │  self_service)
            ┌────┴──────────┴──────────┴──────────┴──────┐
            │              agent-sidecar                  │
            │  ConversationHandler — runs LLM + tools     │
            │  CuratorLoop — handover-resolved → KB,      │
            │     scheduled CRM weekly, CMS monthly       │
            │  RealtimeClient — subscribes for messages,  │
            │     handover_resolved, kb.document.* events │
            └─────────────────────────────────────────────┘
```

The sidecar holds two credentials by design:
- **Admin API key** — subscribes to the realtime gateway, reads + seeds prompt KB documents through an admin-scoped MCP client, fetches conversation history via REST, posts the agent's reply (so it lands as `authorType: 'agent'`), and runs curator skill passes.
- **Per-conversation delegated end-user token** — used to authenticate the per-turn MCP connection, so the LLM only sees what *that end-user* is allowed to see (audience-filtered KB, their own CRM record, only their own conversation handover).

## When you'd run this

You're self-hosting munin and you want a working self-service chat — plus the KB / CRM / CMS curation that come with it — without writing your own runner. If you already have your own agent (Claude Desktop connected via MCP, your own server-side agent, a human staff workflow) you don't need this; leave it off and drive `runSkillPass` from `@getmunin/agent-runtime` directly when you want to run a one-off curator pass.

## Running

```bash
docker compose --profile ai up
```

Local dev outside docker:

```bash
pnpm --filter @getmunin/agent-sidecar dev
```

## Config

Existing `SELF_SERVICE_AI_*` env vars still work as deprecated aliases — when both are set, `MUNIN_SIDECAR_*` wins.

| Var | Required | Default |
|---|---|---|
| `MUNIN_BASE_URL` | yes | `http://localhost:3001` |
| `MUNIN_ADMIN_API_KEY` | yes | — |
| `MUNIN_SIDECAR_PROVIDER_BASE_URL` | no | `https://openrouter.ai/api/v1` |
| `MUNIN_SIDECAR_PROVIDER_API_KEY` | yes | — |
| `MUNIN_SIDECAR_MODEL` | no | `anthropic/claude-haiku-4.5` |
| `MUNIN_SIDECAR_DEBOUNCE_MS` | no | `500` |
| `MUNIN_SIDECAR_MAX_TOOL_ITERATIONS` | no | `8` |
| `MUNIN_SIDECAR_MAX_HISTORY_CHARS` | no | `32000` |
| `MUNIN_SIDECAR_PROMPTS_DIR` | no | shipped `prompts/` next to `dist/` |
| `MUNIN_SIDECAR_CURATORS_DISABLED` | no | `0` (worker stops draining the queue when `1`) |
| `MUNIN_SIDECAR_KB_CURATION_ON_HANDOVER` | no | `1` (per-conversation KB pass; cosmetic — backend always enqueues) |

Sweep cadences live on the **backend**, not the sidecar — they're owned by `@nestjs/schedule` cron jobs there. See `MUNIN_CURATOR_KB_SWEEP_CRON`, `MUNIN_CURATOR_CRM_HYGIENE_CRON`, `MUNIN_CURATOR_CMS_STALE_CRON`, `MUNIN_CURATOR_SCHEDULER_DISABLED` in the root `.env.example`.

## Run as a singleton

**Don't run two `agent-sidecar` processes against the same Munin instance.** Each instance subscribes to the realtime gateway independently and processes every `conversation.message.received` event, so two instances will produce two agent replies (or two handover notes) for the same end-user message. The curator queue is safer — both would race to claim a job via `SELECT ... FOR UPDATE SKIP LOCKED` and only one wins — but conversational replies have no such guard.

The intended OSS deployment is one sidecar process per Munin instance. The docker compose `agent-sidecar` service is configured this way; if you scale it manually (`docker compose up --scale agent-sidecar=2`) you'll see duplicates.

## Behavior

### Conversations

The sidecar reacts only to `conversation.message.received` events (i.e. messages from end-users) and skips when:
- The conversation is closed / snoozed / spam.
- A staff member has claimed the conversation (`assigneeUserId` is set).
- A human teammate has already replied in the conversation (any non-internal `authorType=user` message in history) — the sidecar steps back once a human is in the loop.
- The triggering message wasn't from a `user` / `end_user` actor.

A 500ms debounce after the last triggering event collapses multi-message bursts into one reply. A new triggering event for the same conversation aborts any in-flight run and starts a fresh one with the now-current history.

On provider errors the sidecar retries with exponential backoff (3 attempts). If all attempts fail, it requests handover via MCP — the dashboard's `needsHumanAttention` flag surfaces the conversation to staff, and no agent message is posted.

### Curators

All curator work goes through a persistent `curator_jobs` queue in the backend (RLS-isolated, admin-only). Producers enqueue rows; the sidecar's worker claims them with `SELECT ... FOR UPDATE SKIP LOCKED`, runs the skill via `runSkillPass`, and acks. Failed jobs retry with exponential backoff (30s, 1m, 2m, 4m, 8m) up to `maxAttempts` (default 5), then mark `dead`. Permanent failures (e.g. `skill_missing`) report `retryable=false` and aren't retried.

**Producers:**
- `conv.service` enqueues a `skill://kb/curation` job at the same point it emits `conversation.handover_resolved`, deduped by message id. Per-conversation mode — captures the (question, human-reply) pair within seconds.
- The backend's `CuratorSchedulerService` (`@nestjs/schedule`) enqueues weekly KB safety-net sweeps, weekly CRM hygiene, and monthly CMS stale-content reviews. Cron expressions configurable via env (`MUNIN_CURATOR_*_CRON`).

**Worker** (push-driven, not poll-driven): every enqueue (and every retry-reschedule) emits a `curator_job.pending` event via Postgres `LISTEN/NOTIFY`, which the realtime gateway forwards to the sidecar's websocket. Due-now events trigger an immediate claim; future-dated events (retry backoff) schedule a `setTimeout` to wake at the due time. On websocket reconnect, the sidecar fires one drain to catch anything buffered during downtime. No periodic polling.

The skills:
- **`skill://kb/curation`** — files candidates into `kb-curation-inbox` (admin audience). Operator promotes via `kb_publish_curation_candidate`.
- **`skill://crm/hygiene`** — files merge proposals into `crm_merge_proposals`. Idempotent: re-running for an already-pending pair upserts.
- **`skill://cms/stale-content-review`** — propose-only — produces a structured action report; the operator decides what to act on.

When `MUNIN_SIDECAR_CURATORS_DISABLED=1` the sidecar stops draining the queue, but the backend keeps enqueueing (jobs accumulate harmlessly until you turn the sidecar back on or prune them). To stop production at the source instead, set `MUNIN_CURATOR_SCHEDULER_DISABLED=1` on the backend. Operator review is required for every KB candidate (`kb_publish_curation_candidate`) and every CRM merge proposal (`crm_apply_merge_proposal`) — the sidecar never auto-applies.

### Inspecting the queue

```bash
curl -s -H "Authorization: Bearer $MUNIN_ADMIN_API_KEY" \
  http://localhost:3001/api/curator/jobs?status=pending
```

Statuses: `pending` (waiting to be claimed or retried), `done`, `failed` (terminal), `dead` (exceeded `maxAttempts`).

## Architecture

This sidecar consumes the shared `@getmunin/agent-runtime` package, which holds the LLM ↔ tool-call loop, the provider abstraction, the KB-backed prompt resolver, the conversation handler (debounce + retry + handover), the I/O clients (`createMuninRestClient`, `createRealtimeClient`, `openMcpClient`), and the `runSkillPass` primitive that the curator loop dispatches through. The sidecar itself is env-loading + wiring + lifecycle.

The same kernel backs the multi-tenant cloud's `AgentRunnerService`; per-org config storage and inference billing are layered on top there. The cloud bundles the same event-driven KB path; the OSS sidecar runs in single-tenant mode.

## Out of scope (today)

- Multi-tenant deployments — this is the single-tenant OSS sidecar. Cloud has its own runner.
- Streaming partial replies. Final text only; the widget already polls.
- Per-conversation prompt overrides. One global system + channel prompt set per deployment.
- Inference rate-limiting. The provider's own limits apply.
- Persistent event queue / catch-up beyond the weekly sweep. If your sidecar uptime warrants stronger guarantees, that's a follow-up.
