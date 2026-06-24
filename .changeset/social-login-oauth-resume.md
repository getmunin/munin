---
"@getmunin/dashboard-pages": patch
---

fix(auth): carry the pending OAuth authorize request through Google/GitHub social login

When a client (e.g. an MCP server in Claude) starts the OAuth 2.1 authorization flow and the user signs in with a social provider, the social `callbackURL` now resumes the original `/auth/oauth2/authorize` request instead of dropping to the dashboard. Previously only the email/password path preserved the pending authorize request, so social logins skipped the consent screen and never completed authorization.
