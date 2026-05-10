---
"@getmunin/core": patch
"@getmunin/db": patch
"@getmunin/types": patch
"@getmunin/sdk": patch
"@getmunin/mcp-toolkit": patch
"@getmunin/bootstrap": patch
"@getmunin/backend-core": patch
"@getmunin/agent-host": patch
"@getmunin/agent-runtime": patch
---

Add a `development` package-export condition pointing at `./src/index.ts` (and `./src/schema.ts` for `@getmunin/db`). Loaders that resolve with `--conditions=development` (e.g. the OSS backend's new `node --import @swc-node/register/esm-register --watch --conditions=development src/main.ts` dev script) see the TypeScript source directly; the existing `types` → `dist/*.d.ts` and `default` → `dist/*.js` resolution paths are unchanged, so production runtime, typecheck, and downstream consumers that don't opt into the condition keep their current behavior.
