---
'@getmunin/backend-core': minor
'@getmunin/mcp-toolkit': minor
---

Add public REST endpoint `/api/public/runbooks` (list) + `/api/public/runbooks/:module/:slug` (read) so a marketing site can render runbooks server-side. Honors a `public: true|false` field in runbook frontmatter (default true). The same audience-filtered MCP `resources/list` + `resources/read` paths are unchanged. Also fixes runbook URI derivation so files inside `<module>/runbooks/*.md` produce `runbook://<module>/<slug>` (not `runbook://runbooks/<slug>`).
