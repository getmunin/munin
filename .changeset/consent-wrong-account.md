---
'@getmunin/dashboard-pages': patch
---

The OAuth consent screen now recognises a request bound to an organization the signed-in user doesn't belong to, and asks them to sign in with another account instead of offering an Authorize button that can only fail.

A client that addresses a per-org MCP URL (or carries an `mcp:org:` scope marker) gets its org remembered at authorize, keyed on the session cookie and the PKCE challenge — whatever the caller's memberships. The consent page used to render the full permission list regardless, so a user signed in with the wrong account approved, and the token was refused afterwards. `OAuthConsentPage` now reads `/v1/oauth/pending-org` and `/v1/me/memberships` once the session resolves and, when the pinned org is not one of the user's, renders a "wrong account" pane whose primary action is the existing switch-account flow (sign out, then `/login` with the authorize query intact, so the request resumes under the new account). Cancelling still denies the request back to the client.

The check fails open: if either lookup errors, the ordinary consent screen renders, because the MCP path guard still refuses a token whose org doesn't match.
