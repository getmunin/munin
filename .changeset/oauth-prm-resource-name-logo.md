---
'@getmunin/backend-core': minor
---

Add `resource_name` and `resource_logo_uri` to the OAuth Protected Resource Metadata at `/.well-known/oauth-protected-resource`. Lets MCP clients (Claude.ai connector cards, etc.) display "Munin" plus an icon instead of a generic globe when the resource endpoint serves JSON-only responses.
