---
'@getmunin/backend-core': patch
---

`@AllowAnonymous()` now uses Nest's `SetMetadata(...)` keyed by a stable string (`'munin:allow-anonymous'`) instead of `Reflect.metadata(...)` keyed by a JavaScript `Symbol()`. Symbol identity across compiled module boundaries proved unreliable in production: OAuth discovery endpoints (`/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`) were 401'ing in the cloud deployment even though the controllers had `@AllowAnonymous()` decorators. That's the same metadata the `AuthGuard` reads, so the bypass never triggered.

No call-site changes — `AllowAnonymous` is still imported the same way. Existing consumers (CloudAuthController + every controller with anonymous routes) keep working.
