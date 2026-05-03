# self-service-ai

Optional sidecar service that turns end-user messages on a self-hosted Munin into AI-driven agent replies, using Munin's self-service MCP surface as the agent's tool layer.

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
                 │          │          │  seed +  │  audience=
                 │          │          │  read)   │  self_service)
                 │          │          │          │
            ┌────┴──────────┴──────────┴──────────┴──────┐
            │             self-service-ai                │
            │  PromptResolver — seeds + caches prompts   │
            │                   from KB                   │
            │  ConversationHandler — runs LLM + tools     │
            │  RealtimeClient — subscribes for both       │
            │     conversation.message.received and       │
            │     kb.document.* events                    │
            └────────────────────────────────────────────┘
```

The sidecar holds two credentials by design:
- **Admin API key** — subscribes to the realtime gateway, reads + seeds prompt KB documents through an admin-scoped MCP client, fetches conversation history via REST, and posts the agent's reply (so it lands as `authorType: 'agent'`).
- **Per-conversation delegated end-user token** — used to authenticate the per-turn MCP connection, so the LLM only sees what *that end-user* is allowed to see (audience-filtered KB, their own CRM record, only their own conversation handover).

## Prompts live in the KB

Prompt documents are stored in munin's knowledge base (KB space `agent-runtime`, audience `admin`). On first boot the sidecar:

1. Ensures the `agent-runtime` space exists (creates it if not).
2. For each Markdown file shipped with the `@getmunin/agent-runtime` package (`packages/agent-runtime/prompts/`), ensures a KB document exists at the matching slug. Existing docs are left alone — operator edits take precedence over shipped defaults.
3. Caches the document bodies in memory.
4. Subscribes to `kb.document.updated` events; when a prompt doc changes, refreshes its cached body within seconds. No restart needed.

| File on disk | KB slug (in `agent-runtime` space) |
|---|---|
| `prompts/system.md` | `system-prompt` |
| `prompts/channels/email.md` | `channel-email` |
| `prompts/channels/chat.md` | `channel-chat` |
| `prompts/channels/sms.md` | `channel-sms` |
| `prompts/channels/default.md` | `channel-default` |

To customize prompts after deploy: edit the KB documents through the dashboard or via MCP (`kb_update_document`). Changes propagate live. The on-disk Markdown is only consulted on first boot, when seeding into a fresh KB space.

> **No voice prompt, ever.** This sidecar is not a voice runner and won't become one. Live voice needs sub-second turn-taking, barge-in, and streaming TTS — those constraints belong in a dedicated voice agent runner, not in a generic sidecar that talks to the LLM over batched HTTP. Munin's current voice support is post-call transcript ingestion only; if a `voice` channel does reach this runner, it falls through to `channel-default`.

## When you'd run this

You're self-hosting munin and you want a working self-service chat without writing your own runner. If you already have your own agent (Claude Desktop connected via MCP, your own server-side agent, a human staff workflow), you don't need this — leave it off.

## Running

Drop the variables in your `.env` (see `.env.example`) and start the docker compose profile:

```bash
docker compose --profile ai up
```

Local dev outside docker:

```bash
pnpm --filter @getmunin/self-service-ai dev
```

## Config

| Var | Required | Default |
|---|---|---|
| `MUNIN_BASE_URL` | yes | `http://localhost:3001` |
| `MUNIN_ADMIN_API_KEY` | yes | — |
| `SELF_SERVICE_AI_PROVIDER_BASE_URL` | no | `https://openrouter.ai/api/v1` |
| `SELF_SERVICE_AI_PROVIDER_API_KEY` | yes | — |
| `SELF_SERVICE_AI_MODEL` | no | `anthropic/claude-haiku-4.5` |
| `SELF_SERVICE_AI_DEBOUNCE_MS` | no | `500` |
| `SELF_SERVICE_AI_MAX_TOOL_ITERATIONS` | no | `8` |
| `SELF_SERVICE_AI_MAX_HISTORY_CHARS` | no | `32000` |
| `SELF_SERVICE_AI_PROMPTS_DIR` | no | shipped `prompts/` next to `dist/` |

## Behavior

The sidecar reacts only to `conversation.message.received` events (i.e. messages from end-users) and skips when:
- The conversation is closed / snoozed / spam.
- A staff member has claimed the conversation (`assigneeUserId` is set).
- The triggering message wasn't from a `user` / `end_user` actor.

A 500ms debounce after the last triggering event collapses multi-message bursts into one reply. A new triggering event for the same conversation aborts any in-flight run and starts a fresh one with the now-current history.

On provider errors the sidecar retries with exponential backoff (3 attempts). If all attempts fail, it calls `conv_request_handover_in_my_conversation` via MCP — the dashboard's `needsHumanAttention` flag surfaces the conversation to staff, and no agent message is posted.

## Architecture

This sidecar consumes the shared `@getmunin/agent-runtime` kernel (`packages/agent-runtime/`), which holds the LLM ↔ tool-call loop, provider abstraction, and the KB-backed prompt resolver (with built-in default prompts). The kernel is pure: given a config, conversation history, and an MCP tool handle, it returns a reply. The sidecar wires up the I/O — realtime subscription, REST calls, MCP client lifecycle, and retries.

The same kernel will back the multi-tenant cloud addon when that lands; per-org config storage and inference billing are the only things layered on top.

## Out of scope (today)

- Multi-tenant deployments — this is the single-tenant OSS sidecar. Cloud has its own runner.
- Streaming partial replies. Final text only; the widget already polls.
- Per-conversation prompt overrides. One global system + channel prompt set per deployment.
- Inference rate-limiting. The provider's own limits apply.
