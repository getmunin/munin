---
'@getmunin/dashboard-pages': patch
---

Include `src/` in the published tarballs for every package that declares a `development` export condition (`@getmunin/types`, `core`, `db`, `sdk`, `mcp-toolkit`, `bootstrap`, `backend-core`, `agent-runtime`, `agent-host`).

The `development` condition resolves to `./src/index.ts`, which is the right path in the OSS workspace (pnpm-linked) but didn't exist in the published tarball — `files: ["dist"]` excluded it. Downstream consumers whose toolchain activates the `development` condition (e.g. vitest 2.x in cloud) hit `Cannot find module '.../src/index.ts'` errors at runtime. Shipping `src/` alongside `dist/` makes the condition resolve in both environments.
