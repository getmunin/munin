---
'@getmunin/agent-host': patch
'@getmunin/agent-runtime': patch
'@getmunin/mcp-toolkit': patch
---

Fix the in-process end-user agent actor having no scopes, which silently disabled every self-service-audience tool that requires a write scope (handover, phone-call request, my-contact update, log-activity-self).

- `agent-host`'s `openMcp` factory now passes a default scope set to `openEndUserAgentMcpClient` covering the full self-service surface: `conv:read`, `conv:write`, `kb:read`, `crm:read`, `crm:write`. Previously the actor was built with `[]`, so the MCP dispatcher rejected every gated tool call with a structured `errorResult('Missing required scope: …')` — silently, because tool errors do not throw — and the LLM's call was a no-op.
- `agent-runtime`'s HTTP `mintDelegatedToken` default now includes `crm:write` for parity, so delegated end-user tokens minted by the runtime can call the same self-service surface.
- Adds a regression test asserting a self-service actor with broad scopes is still blocked from admin-audience tools — the audience gate runs before the scope check, so granting an end-user agent `conv:write` does *not* unlock admin conv tools.
