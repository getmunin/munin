---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

OAuth consent UX rework.

**Backend**
- New `GET /api/v1/oauth/clients/:clientId` endpoint (anonymous, on `OAuthModule`) returns the disclosure-safe fields `{ client_id, name, uri, icon }` from the `oauth_client` table. Lets the consent page render the registered client name + URL + logo instead of the random RFC 7591 `client_id`.
- `SUPPORTED_SCOPES` gains `outreach:read` / `outreach:write`. Outreach MCP tools are retagged from `crm:*` to `outreach:*` so an external connector can be granted outreach access without inheriting CRM access.

**Dashboard pages**
- `OAuthConsentPage` rewritten:
  - Fetches the new client-info endpoint on mount, falls back to `client_id` if missing.
  - Hides scopes that aren't user-tunable on the consent screen — `openid`, `profile`, `email`, `offline_access` (OIDC/OAuth standards required by any connector), and `mcp:tools` / `mcp:admin` / `mcp:self_service` (the MCP umbrella + audience-decided-by-user, not by-scope).
  - Groups remaining scopes by user-facing app: Knowledge Base, Conversations, Contacts, Content, Outreach. Internal modules (`bootstrap`, `curator`, `playbooks`, `web`) are not surfaced — they remain reachable via the `mcp:tools` umbrella.
  - Disclosure footer: "Sign-in identity and session refresh are also granted."

Scope-narrowing checkboxes at consent time are still deferred — needs upstream `@better-auth/oauth-provider` support or a wrap-and-mutate layer in the consumer.
