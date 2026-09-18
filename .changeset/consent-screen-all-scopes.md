---
'@getmunin/dashboard-pages': patch
'@getmunin/backend-core': patch
'@getmunin/types': minor
---

Show every requested scope on the OAuth consent screen.

`groupScopes` filtered the requested scopes against a hardcoded nine-module
list and dropped anything else with a bare `continue`. The backend has
advertised far more than nine for a while — `slack:*` since the operator
bridge, `connectors:*`, `commerce:read`, `bookings:*` and `seo:*` since the
connector domains, `social:*` as of this week — and a client that reads
`scopes_supported` off `/.well-known/oauth-protected-resource` asks for all of
them. Those grants were real: `resolveOauthJwtAccessToken` takes the token's
`scope` claim verbatim and `gateOauthGrantsByRole` only ever removes
`mcp:admin`, so the tools backed by the unlisted scopes were callable straight
after consent. The header's "N modules · N scopes" counted the survivors of the
filter, so it under-reported too. Someone reviewing nine cards was granting
sixteen modules' worth of access.

The grouping now lives in `auth/consent-scopes.ts` with the six missing modules
named and described in both locales, and an unrecognised prefix renders a card
listing its raw scope strings instead of vanishing — a module added later is
then a missing translation, not an invisible grant. `identity:read` joins the
hidden set alongside the `mcp:` plumbing: it is the caller's own identity, not
org data. The scope catalog moves to `@getmunin/types` so the consent screen and
the resource metadata can be checked against one list, which is what
`consent-scopes.test.ts` now does.
