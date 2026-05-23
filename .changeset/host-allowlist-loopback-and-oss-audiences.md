---
'@getmunin/backend-core': patch
---

Two follow-up fixes to the 4.7.0 canonical-URL roll-out:

**`@getmunin/backend-core`** — `hostAllowlistMiddleware` always permits loopback (`127.0.0.1`, `localhost`, `::1`). Without this, the bundled `AgentHostRunner` (and any in-process MCP client) hit a 421 `misdirected_request` because their `Host` header is the loopback address — not a public hostname. Cloud has been emitting an `AgentHostRunner failed to start runner` error every 30s since `MUNIN_ALLOWED_HOSTS` shipped in 4.5.1.

The middleware now also parses bracketed IPv6 host headers (`[::1]:3101` → `::1`) correctly.

**`apps/backend`** — `validAudiences` in OSS `createMuninAuth` now equals `baseUrl` exactly instead of `baseUrl + '/mcp'`. After 4.7.0, the canonical resource URL is `MUNIN_PUBLIC_URL` verbatim, so the OAuth provider's audience whitelist needs to mirror that — otherwise external MCP clients (claude.ai web, etc.) can't complete the token exchange. Also drops the locally-shadowed `SUPPORTED_SCOPES` const in favor of `@getmunin/backend-core`'s canonical list (picks up `outreach:*`).
