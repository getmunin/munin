---
'@getmunin/backend-core': patch
---

Accept the MCP resource URL in OAuth `validAudiences` when it differs from the authorization-server host. On cloud (`api.getmunin.com` + `mcp.getmunin.com`), Claude's token exchange was failing with `invalid_request: requested resource invalid` from `@better-auth/oauth-provider`'s `checkResource` — the token endpoint had `validAudiences = [<AS origin>]` only, so the `resource=https://mcp.getmunin.com` parameter (advertised by `/.well-known/oauth-protected-resource` and required because `resource_indicators_supported: true`) was rejected. Externally this surfaced as "Authorization with the MCP server failed" right after the user clicked Authorize.

`createMuninAuthCore` now passes both the AS base URL and `mcpResourceUrl()` (from `NEXT_PUBLIC_MCP_URL`) into `computeValidAudiences`, which returns the union of URL-variant sets for both. OSS single-host topologies (where the two URLs share an origin) dedupe to the same audience list as before. No config changes needed in `munin-cloud` — it already sets both env vars; just bump the lockfile and redeploy.
