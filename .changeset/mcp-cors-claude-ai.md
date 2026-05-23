---
'@getmunin/backend-core': patch
---

Send permissive CORS headers from `/mcp`, the OAuth/OIDC discovery endpoints, and the public client-info endpoint (`/api/v1/oauth/clients/:id`).

Browser-based MCP clients like claude.ai web are served from `https://claude.ai`, which isn't in any deployment's `MUNIN_CORS_ORIGINS` (and shouldn't have to be). Previously the preflight to `/mcp` returned 204 with no `Access-Control-Allow-Origin`, so the browser blocked the POST and showed "Couldn't reach the MCP server". Same gap on the well-known discovery endpoints any OAuth client needs to read cross-origin during dynamic client registration.

Renames the internal predicate `isPublicWidgetPath` → `isPublicCorsPath` and exports it for tests.
