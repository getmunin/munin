---
'@getmunin/core': patch
---

Fix `jwtIssuer()` for split MCP/auth host topologies — verify JWTs against `NEXT_PUBLIC_AUTH_URL`, not the MCP origin.

`oauth-jwt.ts`'s `jwtIssuer()` derived the expected `iss` claim from `NEXT_PUBLIC_MCP_URL`. After PR #238 split `NEXT_PUBLIC_AUTH_URL` from `NEXT_PUBLIC_MCP_URL`, cloud's `mcp.getmunin.com` no longer matched the actual issuer (`https://api.getmunin.com`, set by `betterAuth({ baseURL: NEXT_PUBLIC_AUTH_URL, ... }).plugins[jwt({ issuer })]`). `jwtVerify(..., { issuer: jwtIssuer() })` rejected every valid Claude-issued token, so the OAuth dance completed cleanly but the first `/mcp` request 401'd. End-user symptom: "Authorization with the MCP server failed" reappearing after consent.

`jwtIssuer()` now reads `NEXT_PUBLIC_AUTH_URL` (trim trailing slash) when set, falling back to the MCP origin only for OSS single-host deployments where AS and MCP share an origin.
