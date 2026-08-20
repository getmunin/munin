---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
---

Fix credential-handoff links, which answered `401 invalid or expired credential` on every click in cloud.

`CredentialHandoffController` was a plain `@Controller('v1/credentials')` with no `@AllowAnonymous()`. OSS applies `AuthGuard` per controller, so the endpoint was reachable there and every integration test passed; cloud registers `AuthGuard` as a global `APP_GUARD`, so both the describe (GET) and complete (POST) requests were rejected before the handoff service ran. The entry page fetches with `anonymous: true` — correct, since the link exists for people who hold no Munin credential — which made the failure total: every link minted by `conv_request_channel_credentials`, `conv_configure_email_channel` or `connectors_request_credentials` was dead on arrival, and the auth guard's message read as if the *link* had expired. It is now a `PublicController` with public throttling, guarded by a test that fails if any controller declares neither `AuthGuard` nor an anonymous opt-out.

A channel whose stored config is missing its credential slots now answers the link with a `conv_channel_config_invalid` 400 carrying `fieldErrors`, instead of an unmapped error that surfaced as a bare 500 — the interceptor that maps it only covers the dashboard's channel controller. The entry page names those fields, and no longer keeps showing a stale load error after a later attempt succeeds.
