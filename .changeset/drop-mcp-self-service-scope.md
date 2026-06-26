---
'@getmunin/backend-core': patch
'@getmunin/core': patch
---

fix(oauth): retire the `mcp:self_service` OAuth scope

`mcp:self_service` was advertised in the OAuth discovery metadata (`scopes_supported`), so MCP clients like Claude — which request the full advertised set — were granted it on connect, cluttering every agent's scope list. It was inert (an admin-eligible OAuth agent always resolves to the `admin` audience via `deriveMcpAudience`), and nothing server-side ever used it: the self-service audience is granted directly to server-minted delegated end-user tokens (`audiences: ['self_service']`), not through an OAuth scope.

Removed `mcp:self_service` from `SUPPORTED_SCOPES` (so it's no longer advertised or accepted) and dropped its now-orphaned branch in `deriveAudiencesFromScopes`. Existing tokens keep the scope until they reconnect; behavior is unchanged either way.
