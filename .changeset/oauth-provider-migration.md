---
"@getmunin/db": major
"@getmunin/core": major
"@getmunin/backend-core": major
"@getmunin/dashboard-pages": major
---

Migrate from the deprecated `oidcProvider` (in-tree better-auth plugin) to the published `@better-auth/oauth-provider`. The OAuth schema changes from 3 tables to 4 (`oauth_client`, `oauth_access_token`, `oauth_refresh_token`, `oauth_consent`) plus a `jwks` table for the JWT plugin. RFC 8707 resource indicators are now native via `validAudiences`, JWT access tokens replace opaque tokens for resource-bound flows, and the consent page contract switches from `consent_code` to a signed `oauth_query`. The dashboard consent page is fully localized (en + nb).

Breaking: any deployment with rows in the old `oauth_applications` / `oauth_access_tokens` / `oauth_consents` tables will lose them — Munin OAuth has not been deployed anywhere yet, so this is a no-op in practice.
