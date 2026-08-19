---
'@getmunin/backend-core': minor
'@getmunin/core': minor
---

Carry the organization an org-scoped MCP connection asked for all the way to the token, for clients that send `prompt=consent` or no resource indicator on the authorize request.

An authorization started at `/mcp/o/<orgId>` was landing on the user's default organization instead of the one in the URL. The association that carries the org across the consent redirect was written from inside `consentReferenceId`, and `@better-auth/oauth-provider` returns to the consent page **before** it calls that hook whenever the request carries `prompt=consent` — so on the one leg that names an organization, nothing was ever written, and the consent leg then had nothing to recall. Verified against a live authorization server: not one association row had ever been written, and every consent bound to the default org. Downstream, `AuthGuard` refused the resulting token on the org-scoped path, so the connection came back with no tools at all.

Three changes make the org survive the round-trip:

- The association is written at the auth-request boundary, on any request that names an org, rather than from a provider hook that a prompt can skip.
- It is keyed on both an HMAC of the session cookie and `code_challenge` **and** an HMAC of `code_challenge` alone, so an authorization that starts before the browser has a session — the ordinary case for a first connection — is still recoverable after sign-in. Recall prefers the session-bound key. The challenge-only key is first-write-wins, so a later request cannot repoint an association an earlier one already claimed; a caller who learns another user's `code_challenge` can read which organization it named, which is an opaque id for an authorization they must already hold the URL of.
- The org-scoped protected-resource document advertises a marker scope, `mcp:org:<orgId>`, alongside the usual list. A client requests exactly the scopes that document advertises, so the organization now reaches the authorization server even from a client that only sends `resource` at token exchange, which is where RFC 8707 permits it and where the provider reads it. The marker is stripped from the query and body before the provider validates scopes, so it never reaches a consent screen, a stored grant, or a token, and the shared endpoint's document does not carry one.

The resource indicator remains the primary channel and takes precedence when both are present. A missing association still falls back to the default organization, where the path guard refuses the mismatch, and a signed-in user who is not a member of the requested organization is still refused at consent rather than quietly redirected elsewhere.
