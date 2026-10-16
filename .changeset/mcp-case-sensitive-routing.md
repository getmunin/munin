---
'@getmunin/backend-core': patch
'@getmunin/core': patch
---

A dashboard session can no longer reach `/mcp` by changing the case of the path.

`/mcp` refuses session cookies so that a signed-in dashboard user can't use the MCP surface, which is restricted to owners and admins, without going through OAuth. That check compared the path case-sensitively, but Express matched routes case-insensitively, so a request to `/MCP` reached the MCP controller with the cookie accepted. A session carries every scope, and it carried the `admin` audience whatever the user's role, so a `member` could call every admin tool this way.

Three changes close it:

- `createApp` now builds its Express instance with case-sensitive routing, so `/MCP` is a 404 and every path-prefix check sees the same path the router dispatches on. A deployment that addressed a route with different casing from its declaration will now get a 404 for it.
- The auth guard's MCP check ignores case as well, for apps that build their Express instance some other way.
- A session only carries the `admin` audience when the user is an owner or admin of the org it resolved to. Control-plane routes never read the audience for sessions, so the dashboard is unaffected.
