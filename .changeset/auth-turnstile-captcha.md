---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

feat(auth): optional Cloudflare Turnstile captcha on email auth endpoints

Adds opt-in captcha protection to the BetterAuth email flows (`/sign-up/email`, `/sign-in/email`, `/request-password-reset`). It is disabled by default and turns on only when both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are set — the server verifies the token via the captcha plugin, and the shared login / signup / forgot-password forms render the Turnstile widget using the public site key exposed through `/v1/auth/providers`. Requiring both keys avoids a lockout where the server enforces a captcha the client cannot produce. Self-hosters who set neither key see no change.
