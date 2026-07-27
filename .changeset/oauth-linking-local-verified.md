---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
---

Auth: actually link social sign-ins when the pre-existing local account's email is unverified. better-auth's account linking has a second gate — `requireLocalEmailVerified` (default `true`) — that rejects linking a trusted provider to an existing account whose email isn't verified. Since email/password sign-up runs with `requireEmailVerification: false`, those accounts are unverified, so Google/GitHub sign-in still failed with `account_not_linked`. Set `requireLocalEmailVerified: false` (the incoming provider's verified email is the proof of ownership). Also surface OAuth `?error=` codes on the login page instead of silently showing a clean form.
