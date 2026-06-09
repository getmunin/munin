---
'@getmunin/agent-host': patch
'@getmunin/dashboard-pages': patch
---

Fix the default OpenRouter provider base URL — was `https://openrouter.ai/v1`, should be `https://openrouter.ai/api/v1`.

`PerOrgConfigRepository` materialized new `agent_config` rows with the wrong host, so hitting `/models` returned OpenRouter's marketing HTML page and `AgentModelsService` choked when parsing it. Same typo in the dashboard's `PROVIDER_PRESETS` and in two `shouldEnablePromptCache` test fixtures.

Existing rows already persisted with the wrong URL are backfilled by an idempotent `UPDATE` inside `AGENT_HOST_MULTI_TENANT_DDL` (multi-tenant only — the OSS singleton DDL defaults to Anthropic).
