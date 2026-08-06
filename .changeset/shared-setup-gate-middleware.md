---
'@getmunin/dashboard-pages': minor
---

Add a middleware-safe `@getmunin/dashboard-pages/setup-gate` entry point so every web app can gate the dashboard on onboarding without copying the rule.

`withSetupGate(handler, options)` wraps an existing next-intl middleware and returns a hard `307` to `/<locale>/setup` when the caller is an owner or admin whose org has no name or no LLM provider. Options are `locales`, `scope` (`'root'` or `'subtree'`), `exempt`, `apiUrl` and `timeoutMs`. It leaves an upstream locale redirect untouched, skips the API entirely without a session cookie or on an ungated path, and treats every unknown answer — failed read, missing membership, non-admin member — as "not incomplete", so the client-side `useDashboardGate` remains the backstop.

`isSetupIncomplete` now has a single home in `auth/setup-status.ts` with no imports of its own, shared by the gate and by `resolvePostAuthDestination` (moved to `auth/post-auth-destination.ts`). The predicate was previously duplicated in `apps/web`, which could not import it because middleware must not pull in the `'use client'` root barrel.

For a consumer whose middleware post-processes redirects — rewriting `Location` from `x-forwarded-host`, for instance — wrap the gated handler so that rewriting stays the outer layer; the setup redirect then inherits it instead of pointing at an internal host.
