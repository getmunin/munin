---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
---

fix(control): list OAuth agents from refresh tokens, not access tokens

The previous fix read `oauth_access_token`, but MCP clients (Claude Code, Cursor, …) send a `resource` parameter per RFC 8707, so BetterAuth issues them **stateless JWT access tokens that are never persisted** — that table is empty in practice, so the flock still showed "Agents · 0".

`GET /v1/tokens` now lists live (non-expired, non-revoked) **refresh tokens** — the durable record of a connected OAuth agent. Because dynamic client registration mints a fresh `client_id` on every connect, grants are collapsed into one row per (client name, user) with a connection count. Revoking a row soft-revokes (`revoked = now()`) every live refresh token in that group, so the agent can't refresh back in once its short-lived JWT expires.
