---
'@getmunin/backend-core': patch
---

Integration tests now strictly require `TEST_DATABASE_URL` instead of silently falling back to `DATABASE_URL`. Yesterday's "Failed to decrypt private key" boot loop on dev was caused by `oauth-jwt-resolver.integration.test` running against the dev database (because `TEST_DATABASE_URL` was unset and the fallback let it use `DATABASE_URL`), writing an unencrypted JWK row directly via Drizzle, and never cleaning it up — so the next `pnpm dev` boot tried to read it through BetterAuth's encrypted-key code path and crashed.

Two changes close the loop:

- Every integration + database-touching test in this package (and elsewhere across the workspace) now reads `process.env.TEST_DATABASE_URL` only. When unset, `describe.skip` runs cleanly with a clear "Set TEST_DATABASE_URL" message instead of pointing the test at whatever DB happens to be in `process.env.DATABASE_URL` (typically dev).
- `oauth-jwt-resolver.integration.test` now `afterAll`-deletes its fixture JWK row by `kid`, so even within the dedicated test database no plaintext key lingers between runs.

CI already sets `TEST_DATABASE_URL` in `.github/workflows/ci.yml`, so the pipeline is unaffected. For local development, `.env.example` now declares the variable (default: `postgres://munin_app:munin_app@localhost:5432/munin_test`).
