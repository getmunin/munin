---
'@getmunin/backend-core': patch
'@getmunin/db': patch
---

Restore OAuth authorization under better-auth 1.7. `validAudiences` no longer
exists in `@better-auth/oauth-provider@1.7`, which replaced it with a
DB-backed resource registry, so every authorize request carrying an RFC 8707
`resource` was rejected with `invalid_target: … is not configured` — that is
every MCP connector. The provider is now given `resources` to seed, and
`enforcePerClientResources: false` so dynamically registered clients can reach
them without an explicit link row. Migration `0082` adds the seven columns 1.7
persists on `oauth_refresh_token`, which `0080` added to `oauth_access_token`
but not here; without them the token endpoint answered 500 on both the
authorization_code and refresh_token grants. Org-scoped resources
(`/mcp/o/<orgId>`) are narrowed to their base resource in the authorize query
as they already were in the token body, so they need no registry row and the
org still pins through the code-challenge association.
