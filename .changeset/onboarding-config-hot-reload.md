---
'@getmunin/agent-host': minor
'@getmunin/agent-runtime': minor
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
'@getmunin/db': minor
'@getmunin/core': minor
'@getmunin/types': minor
'@getmunin/sdk': minor
'@getmunin/mcp-toolkit': minor
'@getmunin/bootstrap': minor
'@getmunin/ui': minor
---

Onboarding cleanup, agent-config hot-reload, provider auth validation.

- Dropped the chatbot-name field from the onboarding form; new orgs seed with an empty name so step 1 is shown until the user names their bot.
- Removed the unused `orgs.slug` column (migration 0027); CMS delivery routes (`/api/v1/cms/:orgId/...`) and the matching SDK clients now key on `orgId` rather than the slug.
- `AgentConfigService` validates provider credentials *before* persisting — OpenRouter is probed via `/auth/key` (since its `/models` endpoint is public), Anthropic/OpenAI rely on `/models` 401. Bad keys no longer silently overwrite a working config.
- Saving agent config emits `agent.config.updated` via the WebhookDispatcher; the realtime gateway broadcasts it and `AgentHostRunner` respawns the affected runner — model/provider changes apply without a backend restart.
- Models picker reconciles a stale stored model slug against the fetched model list at render time, so the dropdown can't round-trip an unknown id back to the server.
- Chat widget no longer filters the current session's conversation out of the past-conversation list — going back from a fresh conversation shows it.
