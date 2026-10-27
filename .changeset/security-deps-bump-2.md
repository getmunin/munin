---
"@getmunin/backend-core": patch
"@getmunin/core": patch
"@getmunin/dashboard-pages": patch
"@getmunin/db": patch
---

Upgrade dependencies with published security advisories, including `better-auth` and `@better-auth/oauth-provider` to 1.7.14 (an OAuth state value accepted as a magic-link token, and the OAuth Proxy accepting sign-in state as a provider profile, both allowing sign-in as another user), `@modelcontextprotocol/node` to 2.1.1 (unbounded request bodies and JSON-RPC batches on the HTTP transport), `undici` 7.30.1 and 6.29.1, `nodemailer` 10.2.1, `multer` 2.5.0, `body-parser` 2.4.0, `qs`, `fast-uri` and `postcss-selector-parser`.

better-auth 1.7.3 reverted the 1.7.0 account identity change: accounts are keyed by `(provider_id, account_id)` again and `issuer` is no longer written. Migration `0121_better_auth_account_provider_key` makes `accounts.issuer` nullable, drops the `(issuer, account_id)` unique index and restores the `(provider_id, account_id)` one. Google sign-ins on 1.7.1–1.7.2 were looked up under `https://accounts.google.com` while existing rows had been backfilled as `local:oauth:google`, so a returning Google user could end up with two linked rows for the same account; the migration keeps the most recently updated one. If a provider account is linked to two different users it stops instead and applies nothing. **Apply migrations before or together with this release** — on 1.7.14 without it, every sign-up and account link fails on the `NOT NULL` column. The column is kept so existing rows still carry their issuer if a deploy rolls back.
