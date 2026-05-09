---
'@getmunin/backend-core': minor
---

feat(oauth): MCP resource discovery + WWW-Authenticate (Phase 1)

First step toward MCP-spec OAuth 2.1 compliance:

- New `GET /.well-known/oauth-protected-resource` (RFC 9728) describing the `/mcp` resource: where it lives, which authorization servers can issue tokens for it, supported scopes (`mcp:tools`, `mcp:admin`, `mcp:self_service`, `kb:read`, `conv:write`, …), bearer transport.
- `AuthGuard` emits `WWW-Authenticate: Bearer resource_metadata="…"` on 401 responses for `/mcp/*` requests, per the MCP authorization spec. Other authenticated routes are unchanged.
- New `OAuthModule` exported from `@getmunin/backend-core` so cloud picks it up automatically.

This phase publishes the resource-side metadata. The authorization server endpoints (Better-Auth `oidcProvider`, RFC 8707 resource indicators, consent UI) come in subsequent phases. Existing API key + delegated token flows are untouched.
