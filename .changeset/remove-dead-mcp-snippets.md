---
"@getmunin/dashboard-pages": patch
---

Remove the unused per-client MCP setup snippets. They showed Claude and ChatGPT configured with a pasted `mn_admin_` bearer token, which neither client supports for a remote MCP server; both connect over OAuth. Nothing has rendered them since the first-run redesign, and they were never exported from the package. The first-run screen already tells users to authorize the connection and links to the client guides, which describe the OAuth flow.
