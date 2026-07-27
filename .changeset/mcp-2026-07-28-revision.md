---
'@getmunin/mcp-toolkit': minor
'@getmunin/backend-core': minor
'@getmunin/agent-runtime': minor
'@getmunin/inspector-app': minor
'@getmunin/agent-host': patch
---

Serve MCP protocol revision 2026-07-28 alongside 2025-11-25

`/mcp` now speaks both protocol eras from the same endpoint. Modern clients get the
stateless 2026-07-28 revision (no `initialize` handshake, no `Mcp-Session-Id`,
`server/discover`, per-request `_meta` envelope, `Mcp-Method`/`Mcp-Name` header
validation); existing 2025-era clients keep working unchanged.

- Migrated from `@modelcontextprotocol/sdk` v1 to the v2 package split
  (`@modelcontextprotocol/{server,client,node}`). `createMcpServer` now returns a v2
  `Server`, and the HTTP entry is `createMcpHandler` + `toNodeHandler` instead of
  `StreamableHTTPServerTransport`. **Breaking for anyone embedding
  `@getmunin/mcp-toolkit` directly.**
- `tools/list`, `resources/list` and `resources/read` advertise `ttlMs` /
  `cacheScope` on the 2026 revision, scoped `private` because listings are filtered
  per actor audience and scopes.
- `tools/list` is now returned in a stable, name-sorted order so clients can cache it.
- The authorization server advertises
  `authorization_response_iss_parameter_supported` (RFC 9207 / SEP-2468), which
  BetterAuth already emits, and derives its BetterAuth `baseUrl` from
  `authorizationServerUrl()` so the advertised issuer and the emitted `iss` cannot
  drift apart.
