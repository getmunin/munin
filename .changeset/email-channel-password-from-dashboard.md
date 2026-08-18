---
'@getmunin/backend-core': patch
---

fix(conv): let the dashboard change an email channel's SMTP/IMAP password

`POST /v1/conversations/channels/email` was wired to `EmailAdminTools.setupChannel`, which hardcodes `rejectSecrets: true` so passwords can never enter through an agent conversation. The control plane inherited that restriction, so saving the channel edit dialog with a password typed in failed with `conv_invalid: secret fields (outbound.password, inbound.password) cannot be accepted through this tool` — and there was no other dashboard path to rotate a password once a channel was active.

The controller now calls the new `EmailService.configureChannel` directly (no flag), matching how the generic vendor-channel and connector controllers already sit next to their MCP tools. Agents still get the credential-link flow: the tool passes `rejectSecrets: true` on both create and update.

`updateChannel` also recomputes activation: an update that leaves a required SMTP or IMAP password missing — adding an inbound mailbox to an outbound-only channel, say — now sets `active: false` instead of leaving a channel advertised as active that the poll and delivery workers can only fail on. It never activates, since `active: false` also means operator-paused or auto-deactivated after repeated polling failures; entering the missing password (credential link or dashboard) is what turns the channel back on.
