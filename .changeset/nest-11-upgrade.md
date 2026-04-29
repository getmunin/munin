---
'@getmunin/backend-core': minor
---

Upgrade NestJS to v11 (was v10). Patches GHSA-36xv-jgw5-4q75 (SSE field
injection). Consumers of `@getmunin/backend-core` must upgrade their own
`@nestjs/*` deps to `^11.x` and `express` to `^5.x`. Wildcard route paths
must use the new path-to-regexp v8 syntax (e.g. `*splat` instead of `:rest(.*)`).
