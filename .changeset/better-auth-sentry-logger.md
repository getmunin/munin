---
'@getmunin/backend-core': minor
'@getmunin/backend': minor
---

Forward BetterAuth log errors to Sentry.

`createMuninAuthCore` now accepts a `logger` option (passthrough to BetterAuth). The OSS `apps/backend` wires it up with `sentryForwardingLogger(Sentry.captureException)`, which captures every `level === 'error'` log entry — including the background-task failures BetterAuth catches internally (e.g. SMTP errors during `sendResetPassword`).

Without this, BetterAuth's `try { … } catch (err) { logger.error('Failed to run background task', err) }` pattern swallowed real failures: the error never reached Sentry's unhandled-exception/rejection hooks, so issues like the recent `551 5.5.3 Domain name must be added` SMTP rejection were invisible to alerting.

Consumers passing a custom `logger` can either omit the helper or extend it; the option type matches `BetterAuthOptions['logger']` directly.
