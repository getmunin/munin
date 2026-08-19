---
'@getmunin/backend-core': minor
'@getmunin/core': minor
---

Serve the MCP endpoint per organization at `/mcp/o/<orgId>`, so one user can hold simultaneous connections to several organizations.

MCP clients key a connection by its URL: one URL means one stored credential, so a user who belongs to more than one organization could only ever be connected to whichever one the token happened to be pinned to. The tools, the registry, and the handler are unchanged — only the addressing and the org pinning are new.

`/mcp/o/<orgId>` routes into the same handler, and `AuthGuard` requires the credential's org to equal the org in the path. An admin API key already carries its org, so it works immediately; a mismatch answers 401 with `WWW-Authenticate` pointing at that org's protected-resource document, which is what makes an OAuth client re-run authorization and land on the right organization instead of failing permanently. The shared `/mcp` endpoint keeps accepting any org, so existing connections are untouched.

For OAuth the organization arrives in the resource indicator. `/.well-known/oauth-protected-resource/mcp/o/<orgId>` advertises the org-scoped URL as its own resource identifier, which the MCP SDK echoes back as `resource` on the authorization request; `consentReferenceId` then pins the token to that organization and fails when the signed-in user is not a member, rather than silently falling back to their default org. The document validates only the shape of the org id and names no organization, so it is not an org-existence oracle.

Three constraints from `@better-auth/oauth-provider` shaped the implementation, and each one is load-bearing:

`validAudiences` is a static `string[]` and the options object is spread at construction, so a per-request audience cannot be injected there and an unbounded set of per-org resources cannot be enumerated ahead of time. The resource is therefore narrowed to the base MCP resource on token requests — the only place the provider validates it. Tokens keep `aud` = the base resource with the organization in `org_id`, and the path guard is what enforces the boundary.

`resource` does not survive the redirect to the consent page: the provider signs the *validated* authorize query, and `resource` is not part of that schema (it reads it from the token request body instead). The organization is therefore carried across the round-trip in a short-lived `verifications` row, keyed on an HMAC of the session cookie and `code_challenge` under the server's auth secret — `code_challenge` survives the redirect and PKCE is mandatory for MCP clients, so the key is always available on both legs. The row is written only once membership has been verified, from inside `consentReferenceId`, and read back on the consent request, where the `referenceId` that actually reaches the token is computed. Without this the token pinned to the user's default organization for every non-default one, which the endpoint then rejected permanently.

The session is part of the key on purpose. `code_challenge` is not a secret — it travels in the authorization URL, so it reaches browser history, referrers and access logs — and keying on it alone let any authenticated caller who learned a victim's challenge repoint that victim's pending association, or write rows for organizations they had no part in. Binding the key to the session cookie puts every caller in their own keyspace, and keying the MAC with the server secret means database read access alone cannot confirm a guessed session token, and deferring the write until after the membership check means a refused authorization stores nothing. A missing association or an unavailable store falls back to the default organization, where the path guard still refuses the mismatch.

A path under `/mcp/o/` that does not parse as a valid organization id is refused with 404 rather than falling through to shared-endpoint behaviour. Failing open there was not a tenancy hole — the handler resolves the organization from the credential and never reads the path, so the path can only ever constrain a request, never select it — but it did mean a wrong-case or percent-encoded id produced a *working* connection that silently acted in the caller's default organization, which is exactly the confusion the org-scoped URL exists to remove.

`consentReferenceId` receives no request context, so the requested organization reaches it through an `AsyncLocalStorage` scope established at the auth request boundary.
