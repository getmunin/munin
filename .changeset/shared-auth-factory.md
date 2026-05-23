---
'@getmunin/backend-core': minor
---

Extract `createMuninAuthCore` factory in `@getmunin/backend-core/auth` so OSS and cloud share one Better Auth setup.

Cloud has its own `cloud-auth.ts` because its multi-tenancy model is different (personal-org-per-signup vs OSS's single-shared-org-with-invite-gate) and it wires social providers + user-deletion flows OSS doesn't. But ~70% of the file was a literal copy of the OSS auth config: `drizzleAdapter` schema mapping, `jwt({ issuer })` plugin, `oauthProvider({...})` block, `emailAndPassword`, `emailVerification`, `SUPPORTED_SCOPES` composition, and the `computeValidAudiences` + `uniqueOrigins` helpers. That copy drifted twice — first when the original audience mismatch landed (fixed in OSS #208 then again in cloud #111), and again when the variant-tolerance fix landed (OSS #213, never propagated to cloud, which is why claude.ai's OAuth flow broke on cloud-dev after the 4.9.0 cloud bump).

New shared factory accepts the caller-specific bits as options:

- `signupBefore(user)` / `signupAfter(user)` — OSS passes invite-gate + singleton-org membership; cloud passes personal-org provisioning.
- `sendResetPassword`, `sendVerificationEmail` — callers supply mailer-bound callbacks (OSS and cloud have different template copy).
- `deleteUser?: { beforeDelete, sendDeleteAccountVerification }` — cloud-only.
- `socialProviders?: { google, github }` — cloud-only.
- `crossSubDomainCookies?: { domain }` — cloud-only (`*.getmunin.com`).
- `rateLimit?` — cloud uses an env toggle for tests.

Everything OAuth-protocol-related (oauthProvider config, validAudiences derivation, jwt issuer, supported scopes, JWKS schema mapping) lives in one place. `computeValidAudiences` is now exported from `@getmunin/backend-core` directly — its variant set (`{canonical, +slash, origin, origin+/}`) is the canonical source of truth for both OSS and cloud.

OSS `apps/backend/src/auth/auth.config.ts` slimmed from ~250 to ~135 lines (now only the OSS-specific signup gate + singleton membership logic). The `computeValidAudiences` unit test moved to `packages/backend-core/src/auth/auth-factory.test.ts`.

Cloud-side adoption ships in a separate cloud-repo PR alongside the @getmunin/* bump to the resulting release.
