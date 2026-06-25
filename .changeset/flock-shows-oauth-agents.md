---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
---

fix(control): show OAuth-authorized agents in the flock

The Settings → Agents page ("The flock") read only the `tokens` table, which is populated solely by delegated end-user tokens. OAuth-authorized MCP clients (Claude Code, Cursor, Claude Desktop, …) have their access/refresh tokens persisted by BetterAuth in the separate `oauth_*` tables, so a fully-connected agent always showed up as "Agents · 0 / No connected agents yet".

`GET /v1/tokens` now also lists live (non-expired) OAuth access tokens — one row per (client, user), scoped to the calling org via `org_members` — with the OAuth client name as the origin. Revoking such a row (`DELETE /v1/tokens/:id` for an `oat_*` id) deletes both the access and refresh tokens so the agent can't silently refresh back in.
