---
'@getmunin/agent-runtime': patch
---

Fix misleading `created KB space agent-runtime` log on every backend
startup. `ensureSpace` and `ensureDocument` were using `try/catch` to
detect "already exists" conflicts, but `mcp.callTool()` never throws on
tool errors — the MCP dispatch layer converts thrown errors into
`{ isError: true, content: [...] }` results. The catch was unreachable
dead code, so the success log fired on every reconcile even when the
space/document already existed (the row itself was not being recreated).

Switch both helpers to inspect `result.isError` (the same pattern as
`parseDocumentBody`). Conflict path returns silently; non-conflict
errors now actually throw. Test fake MCP handle was also returning a
rejected promise for the conflict case, which hid the bug — updated to
match real dispatch behavior.
