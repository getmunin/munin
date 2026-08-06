---
'@getmunin/backend-core': patch
---

Advertise `offline_access` in the protected-resource metadata so Claude Code can authenticate.

`/.well-known/oauth-protected-resource` listed only the Munin permission scopes. The MCP SDK
uses that list verbatim as the `scope` of its dynamic client registration (SEP-835 scope
selection), so the resulting OAuth client was stored without `offline_access`. Claude Code then
requested `offline_access` at `/auth/oauth2/authorize` to obtain a refresh token, and Better
Auth validates the requested scopes against the *client's* registered scopes before falling back
to the server-wide list — so the browser landed on `invalid_scope: The following scopes are
invalid: offline_access`. claude.ai was unaffected because it registers without a `scope`, which
defaults the client to the full server-wide list.

The two metadata documents now derive from one source: `STANDARD_OIDC_SCOPES`,
`SUPPORTED_AUTH_SCOPES` and the new `RESOURCE_ADVERTISED_SCOPES` all live in
`oauth.constants.ts`, and a test asserts the resource metadata never advertises a scope the
authorization server would reject.
