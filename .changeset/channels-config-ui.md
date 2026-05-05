---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

Channels can now be created and managed from the dashboard.

**Backend** — new REST controller at `/api/conv/channels`:

- `GET /` — list widget + email channels for the org.
- `POST /widget` — create a chat-widget channel; mints and returns a one-shot `mn_widget_*` API key bound to the channel and origin allowlist.
- `POST /widget/:id` — update name / origin allowlist / display name.
- `POST /widget/:id/rotate-key` — revoke prior keys and mint a new one (one-shot return).
- `POST /email` — create an email channel with operator-supplied SMTP credentials and optional IMAP for inbound. Passwords are encrypted at rest.
- `POST /email/:id/test` — verify SMTP/IMAP credentials before enabling.

Munin doesn't ship a built-in mailer; email channels require operator-provided SMTP, matching the OSS posture for outbound on every other surface.

**Dashboard** — new "Channels" entry under Settings with an "Add channel" dropdown (chat widget / email). Each option opens a dedicated dialog. Widget cards expose the bound key on creation and rotation; email cards expose a "Test" button. Norwegian (`nb`) translations included.
