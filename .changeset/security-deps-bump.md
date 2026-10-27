---
"@getmunin/agent-host": patch
"@getmunin/agent-runtime": patch
"@getmunin/backend-core": patch
"@getmunin/core": patch
"@getmunin/dashboard-pages": patch
"@getmunin/inspector-app": patch
"@getmunin/mcp-toolkit": patch
"@getmunin/sdk": patch
"@getmunin/types": patch
---

Upgrade dependencies with published security advisories: `@modelcontextprotocol/server` and `@modelcontextprotocol/client` to 2.3.0 (cross-client message delivery on shared transports, request-validation memory exhaustion, bearer tokens accepted across audiences, credentials re-sent on cross-origin redirects) and `zod` to 4.6.6 (memory exhaustion on oversized constrained collections). Transitive `ip-address`, `follow-redirects`, `launch-editor`, `shell-quote` and `vite` are pinned past their advisories too.
