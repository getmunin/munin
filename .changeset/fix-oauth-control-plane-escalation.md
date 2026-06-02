---
'@getmunin/core': patch
'@getmunin/backend-core': patch
---

**Security (critical)**: prevent OAuth bearer tokens from acting as control-plane credentials.

Before this patch, an OAuth access token with any non-empty scope set — even one
containing only `openid` — resolved to a `user` actor whose `ControlPlaneGuard`
branch (`actor.type === 'user' → return true`) admitted it without checking the
token's audience or scopes. Combined with `deriveAudiencesFromScopes` defaulting
to the `admin` audience for any scope-bearing token, every issued OAuth token
was effectively a full org-admin key for the dashboard's `/v1/*` REST surface
(conversations, inbox, activity, curator jobs, CRM, CMS, …).

Three changes:

- `deriveAudiencesFromScopes` no longer falls back to `admin` when no `mcp:*`
  scope is present. `admin` requires `mcp:admin`, `self_service` requires
  `mcp:self_service`.
- `ControlPlaneGuard` rejects `user` actors whose credential carries an MCP
  resource `audience` (i.e. was issued via OAuth). Session-cookie users — whose
  credentials never set `audience` — still pass.
- `AuthGuard` enforces audience binding on every route, not just `/mcp`. A
  bearer minted for the MCP resource cannot be presented to `/v1/*`.
