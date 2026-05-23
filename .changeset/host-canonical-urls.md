---
'@getmunin/backend-core': minor
'@getmunin/core': patch
'@getmunin/dashboard-pages': patch
---

`MUNIN_PUBLIC_URL` is now the **canonical MCP resource URL** verbatim — no implicit `/mcp` appending. Adds an optional `MUNIN_API_URL` for a canonical REST URL.

**Backend (`@getmunin/backend-core`)**
- `mcpResourceUrl()` returns `MUNIN_PUBLIC_URL` exactly. `authorizationServerUrl()` (and `readPublicBaseUrl()`) return its origin.
- New `publicUrlRewriteMiddleware` maps the canonical external URLs onto the internal Nest mount points — `/mcp` for MCP, `/api/v1` for REST. So a deploy can advertise `https://mcp.example.com` (no path) and `https://api.example.com/v1` while every controller stays mounted at its original internal path. Pass-through when the env vars name the same internal path (OSS default).
- Adds `MCP_INTERNAL_PATH` (`'/mcp'`) and re-exports the old `MCP_RESOURCE_PATH` for back-compat.

**Default change** — OSS default `MUNIN_PUBLIC_URL` is now `http://localhost:3001/mcp` (path included). Existing self-hosters who set `MUNIN_PUBLIC_URL=http://localhost:3001` (no path) will see their OAuth resource URL change from `…/mcp` to bare host — every active token will need refreshing. To keep the old behavior verbatim, set `MUNIN_PUBLIC_URL=http://localhost:3001/mcp`.

**Dashboard (`@getmunin/dashboard-pages`)**
- `GetStarted` fetches the canonical MCP URL from `/.well-known/oauth-protected-resource` and renders it in the Claude / ChatGPT / Gemini config snippets. OSS self-host now shows `http://localhost:3001/mcp` (or whatever the local backend advertises); cloud shows `mcp.getmunin.com`.
- `mcp-setups.ts` ships a `buildMcpSetups(host)` helper alongside the static fallback.
