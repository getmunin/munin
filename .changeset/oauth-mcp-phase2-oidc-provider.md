---
'@getmunin/db': minor
'@getmunin/core': minor
'@getmunin/backend-core': minor
---

feat(oauth): wire Better-Auth oidcProvider, add OIDC tables, alias `/.well-known/oauth-authorization-server`

Phase 2 of MCP-spec OAuth 2.1 compliance. Builds on the Phase 1 resource-discovery scaffolding.

**`@getmunin/db`**: three new tables for Better-Auth's OIDC provider plugin: `oauth_applications` (registered clients via DCR), `oauth_access_tokens` (issued tokens, separate from the legacy `tokens` table), `oauth_consents` (per-user consent records).

**`@getmunin/core`**: `CredentialResolver.resolveBearerToken()` now also matches against `oauth_access_tokens`. OAuth-issued tokens resolve to a `user`-type actor with the user's default org membership and the requested scopes. Audiences are derived from `mcp:admin` / `mcp:self_service` scope presence.

**`@getmunin/backend-core`**:
- New `OAuthAsAliasController` exposing `/.well-known/oauth-authorization-server` (RFC 8414) by proxying Better-Auth's `/auth/.well-known/openid-configuration`. MCP clients hit a single discovery URL on the resource host.
- Updated `OAuthModule` to include the alias.

**`apps/backend`** (not in changeset): wires `oidcProvider` plugin in `auth.config.ts` with PKCE required, DCR enabled, the full Munin scope list (`openid`, `profile`, `email`, `offline_access`, `mcp:tools`, `mcp:admin`, `mcp:self_service`, `kb:*`, `conv:*`, `crm:*`, `cms:*`), and consent-page redirect to `/dashboard/oauth/consent`.

End-to-end DCR flow tested: `POST /auth/oauth2/register` mints a client; `GET /.well-known/oauth-authorization-server` reports the right endpoints; the issued tokens, when sent as `Authorization: Bearer`, resolve correctly through `CredentialResolver`.

Still missing for full MCP-spec compliance:
- RFC 8707 resource indicators (Phase 3) — `aud` claim binding to a specific resource URL
- Consent UI page (Phase 4) — currently uses Better-Auth's default
- Conformance audit (Phase 5)
