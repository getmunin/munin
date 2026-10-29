---
"@getmunin/docs-pages": patch
---

The Connect Claude and Connect ChatGPT guides now describe OAuth sign-in instead of pasting an `mn_admin_` API key. Neither client can send a static bearer token to a remote MCP server: Claude's custom connector dialog offers OAuth client settings (request headers are a limited beta), and ChatGPT offers OAuth or no authentication. Following the old steps produced a connector that could never authenticate. Both guides now walk through adding the server, signing in to Munin and approving the consent screen, which organization the connection binds to, and revoking access under Settings → Agents. The ChatGPT guide also follows OpenAI's current flow (Plugins → Add custom MCP server), since the separate Developer Mode toggle has been removed.
