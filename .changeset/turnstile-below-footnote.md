---
'@getmunin/dashboard-pages': patch
---

fix(auth): move Turnstile widget below the footnote links on auth forms

Repositions the Cloudflare Turnstile widget to render below the "Create an account · Forgot password?" (and equivalent) footnote links on the login, signup, and forgot-password forms, instead of between the password field and the submit button. Submit gating is unchanged — the button still stays disabled until a captcha token is present.
