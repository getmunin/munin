---
'@getmunin/dashboard-pages': patch
'@getmunin/inspector-app': patch
'@getmunin/agent-runtime': patch
'@getmunin/backend-core': patch
'@getmunin/mcp-toolkit': patch
'@getmunin/agent-host': patch
'@getmunin/docs-pages': patch
'@getmunin/emails': patch
'@getmunin/types': patch
'@getmunin/core': patch
'@getmunin/sdk': patch
'@getmunin/db': patch
'@getmunin/ui': patch
---

Stop shipping test files in published tarballs.

Every package listed `src` and/or `dist` in `files` with no `.npmignore`, so each
tarball carried the full test suite: `@getmunin/agent-runtime` published 226 files
of which 100 were `*.test.ts`, `*.test.js`, their declaration files and source maps.
Test fixtures are the one place a repository accumulates captured real-world
data — addresses, names, message bodies — and a published tarball is immutable,
so anything that reaches one cannot later be edited or rewritten out.

`files` now carries `!**/*.test.*` (plus `!src/test/**` for `@getmunin/dashboard-pages`,
whose render and fixture helpers live there). No published entry point referenced
either: `@getmunin/dashboard-pages` exposes only `.`, `./server`, `./setup-gate`
and `./messages/*.json`, and nothing in this repo or munin-cloud imports a test
file across a package boundary. `@getmunin/agent-runtime` drops to 126 files,
`@getmunin/backend-core` and `@getmunin/dashboard-pages` to zero test files each.
