---
'@getmunin/backend': patch
---

**Security**: rate-limit `/auth/*` endpoints.

Previously `/auth/*` was anonymous-by-design but not throttled. Login, signup,
forgot-password, OAuth dynamic-client-registration, and OAuth token endpoints
were all subject only to BetterAuth's defaults (in-memory, off by default in
dev). Two layers now:

- Nest's `ThrottlerGuard` is attached to the controller (`PublicController('auth',
  { throttle: true })`) — a generic per-IP ceiling (60/min, 1000/hr from
  `MUNIN_PUBLIC_THROTTLE_*`) that runs before BetterAuth touches the request.
- BetterAuth's own per-path rate limiter is enabled with DB storage (the
  `auth_rate_limit` table already existed), default 30/min, plus `customRules`
  ratcheting `/sign-in/email`, `/sign-up/email`, `/forget-password`,
  `/reset-password`, `/oauth2/register`, and `/oauth2/token` down further.

Defaults tunable via `MUNIN_AUTH_RATELIMIT_WINDOW` (seconds) and
`MUNIN_AUTH_RATELIMIT_MAX`.
