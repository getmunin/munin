---
'@getmunin/mcp-toolkit': minor
'@getmunin/backend-core': patch
---

`tools/list` now intersects the caller's scopes with each tool's required `scopes`, in addition to the existing audience filter. Previously the list returned every audience-matched tool regardless of whether the caller actually held the scopes needed to invoke it — so a connector advertising `analytics:read` would happily list `analytics_*` tools to an OAuth caller whose token didn't carry that scope, and the model would only discover the mismatch by wasting a turn on a `"Missing required scope: ..."` error.

After this change, `listTools` (and therefore the MCP `tools/list` response) only returns tools where every scope in `tool.meta.scopes` is held by the actor — including the existing `*` wildcard short-circuit, so internal `buildAdminAgentActor` callers are unaffected. Tools with `scopes: []` (like the feedback module) remain visible to everyone in the audience.

`callTool` is unchanged — defense-in-depth scope check at dispatch time still fires if a caller invokes a hidden tool by name.
