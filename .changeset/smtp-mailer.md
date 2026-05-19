---
'@getmunin/core': minor
'@getmunin/db': minor
'@getmunin/types': minor
'@getmunin/sdk': minor
'@getmunin/mcp-toolkit': minor
'@getmunin/bootstrap': minor
'@getmunin/ui': minor
'@getmunin/dashboard-pages': minor
'@getmunin/backend-core': minor
'@getmunin/agent-runtime': minor
'@getmunin/agent-host': minor
---

Add generic `SmtpMailer` provider to `@getmunin/core`.

Covers any SMTP-speaking transactional email service (Scaleway TEM, Postmark,
Mailgun, Postmark, etc.) via a single implementation. Activated by setting
`MUNIN_MAIL_PROVIDER=smtp` along with `MUNIN_SMTP_HOST`, `MUNIN_SMTP_PORT`,
`MUNIN_SMTP_USER`, `MUNIN_SMTP_PASSWORD` (optional `MUNIN_SMTP_SECURE=1` for
implicit-TLS on port 465). `nodemailer` is the underlying transport.
