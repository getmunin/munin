---
'@getmunin/dashboard-pages': minor
'@getmunin/web': patch
---

Promote the auth pages — `LoginForm`, `SignupForm`, `ForgotPasswordPage`, `ResetPasswordPage`, `VerifyEmailPage`, and `AuthLoading` — into `@getmunin/dashboard-pages` so OSS and cloud can share one implementation. Each accepts the brand footer as a prop (`OSS_AUTH_FOOTER` or `CLOUD_AUTH_FOOTER`); the signup form keeps OSS's invite-token lookup and gains OAuth provider buttons; the login form keeps `redirectTo` handling and moves the forgot-password link into the footnote next to "Create an account" (shortened from "Forgot your password?" to "Forgot password?"). The shared `useTranslateError` (and the pure `translateError` / `getErrorCode` helpers) are now re-exported from the package root, replacing the per-app duplicates.
