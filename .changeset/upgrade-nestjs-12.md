---
"@getmunin/backend-core": minor
"@getmunin/agent-host": minor
---

Upgrade NestJS from v11 to v12 (`@nestjs/common`, `core`, `platform-express`, `testing` to 12.0.1; `@nestjs/schedule` 6 → 12; `@nestjs/swagger` 11 → 12).

`@nestjs/cli` deliberately stays on v11. v12 of the CLI depends on `typescript@~6.0.2` and its `@nestjs/schematics` peer requires `typescript >=6.0.0`, which would drag TypeScript 6 into the workspace and — because `@getmunin/eslint-config` had no `typescript` of its own — silently bind `typescript-eslint` to a different compiler than the rest of the repo. The CLI has no peer on `@nestjs/core` and is only used for `nest build`, so keeping it on v11 decouples the TypeScript 6 decision from this upgrade.

Nest 12 ships its core packages as native ESM, consumed here from CommonJS via Node's `require(esm)`. No application source changes were needed: the guard, interceptor, pipe and exception-filter contracts are unchanged in v12, `rxjs` stays on v7, and Express was already on v5 under Nest 11.

Three dependencies have not yet published a Nest 12 peer range — `nestjs-zod`, `@nestjs/throttler` and `@sentry/nestjs` — so each gets an explicit `pnpm.peerDependencyRules.allowedVersions` entry instead of relying on the repo-wide `strict-peer-dependencies=false`. All three are metadata-only gaps; their runtime behaviour is exercised by the existing suites.
