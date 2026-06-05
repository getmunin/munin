---
'@getmunin/backend-core': minor
---

Add `analytics:read` and `analytics:write` to `SUPPORTED_SCOPES`. The analytics MCP tools (`analytics_create_tracker`, `analytics_list_trackers`, `analytics_top_subjects`, etc.) have been declaring those scopes in their `@McpTool` decorators since the module landed, but the OAuth supported-scopes registry never picked them up. That meant OAuth tokens could never carry the analytics scopes, so every external call (e.g. from a ChatGPT connector) hit *"Missing required scope: analytics:read"* at the dispatch guard — even though the tools showed up in `tools/list`. Internal `buildAdminAgentActor` callers were unaffected because they use the `*` wildcard.

`SELF_SERVICE_SCOPES` (delegated end-user tokens) is intentionally not changed — analytics is admin surface, in the same bucket as `cms:write` / `outreach:write` / etc. that end-user tokens never see.
