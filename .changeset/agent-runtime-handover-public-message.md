---
'@getmunin/backend-core': patch
'@getmunin/agent-runtime': patch
---

Fix silent handover when the agent runtime exhausts retries against an unhealthy LLM provider.

- `conversation-handler` now calls a new admin REST endpoint (`POST /v1/conversations/:id/request-handover` with `publicFallbackMessage`) instead of routing handover through an end-user MCP tool call. The MCP path required `conv:write` scope on the end-user agent actor, which the in-process agent host doesn't grant — so the call was being silently denied with an MCP `errorResult`, leaving the conversation un-flagged and the end user staring at an empty widget.
- `convService.requestHandover()` now accepts an optional `publicFallbackMessage`. When set, it posts a user-visible agent message (`internal: false`, `metadata.kind = "handover_fallback"`) so the end user sees confirmation that a teammate is coming, even when the LLM never produced any reply. Mirrored on the admin `conv_request_handover` MCP tool and `POST /v1/conversations/:id/request-handover` HTTP route.
- `MuninRestClient` gains a `requestHandover(conversationId, { reason, publicFallbackMessage })` method.
