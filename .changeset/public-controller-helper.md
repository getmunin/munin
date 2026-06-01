---
'@getmunin/backend-core': patch
---

Fix accidentally protected public endpoints in cloud builds. Cloud
registers AuthGuard globally via `APP_GUARD`, so any controller without
`@AllowAnonymous()` gets a 401 — that left `/v1/cms/...` delivery,
provider webhooks (`POST /v1/conversations/channels/:id/webhook`),
health probes (`/healthz`, `/readyz`, `/version`), and signed-URL
uploads (`/static/assets/upload`) accidentally auth-gated.

Adds a `@PublicController(path, { throttle? })` helper that bundles
`@Controller` + `@AllowAnonymous` (and optionally `ThrottlerGuard`)
so the "public" intent is a single greppable declaration.
