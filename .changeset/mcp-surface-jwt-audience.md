---
'@getmunin/core': minor
'@getmunin/backend-core': minor
---

Accept a registered MCP surface as a token audience, and report which resource a JWT was actually issued for.

Registering a surface made the authorization server issue tokens for `<origin><surface path>`, but nothing downstream would accept one. `acceptedJwtAudiences()` builds a fixed set from `NEXT_PUBLIC_MCP_URL` — the canonical URL, its trailing-slash variant, and the bare origin — so a JWT whose `aud` names a surface failed audience validation and `resolveOauthJwt` returned null. The request came back `401 invalid or expired credential` on the surface's own endpoint, with a `WWW-Authenticate` challenge pointing at metadata the client had already followed correctly. In other words: the moment a host registered a surface, every newly issued token for it was dead on arrival, while tokens issued before the surface existed kept working — a failure that appears only after a deploy, only for new connections, and looks like a credential problem rather than a configuration one.

Registered surface paths now live in a small module registry in `@getmunin/core` (`registerMcpResourcePaths`, called by `McpSurfacesModule.forRoot` and by `AuthGuard` when surfaces are injected directly, so either wiring path is enough). Paths rather than URLs, resolved against the MCP origin on read, so the accepted set follows `NEXT_PUBLIC_MCP_URL` at call time instead of freezing whatever it was during module construction.

`acceptedJwtAudiences()` unions those resources in, and `resolveOauthJwt` now reports `audience` as the resource the matched `aud` denotes rather than unconditionally the base: a surface audience is reported as itself, and every other accepted shape (bare origin, trailing slash, canonical) still folds onto the base resource exactly as before. That is what makes `AuthGuard`'s per-surface audience check real for JWT credentials — until now the guard compared against a value the resolver hardcoded, so a surface-scoped token was indistinguishable from a base one.

Opaque OAuth access tokens are unchanged: `oauth_access_token` records no resource, so they continue to report the base audience, which the guard accepts on surface paths. Per-surface isolation therefore applies to JWT credentials only, and this is deliberate rather than an oversight — narrowing opaque tokens would need a schema column and a migration.
