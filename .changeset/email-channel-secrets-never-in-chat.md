---
'@getmunin/backend-core': minor
---

Email channel passwords can no longer transit the conversation

`conv_setup_email_channel` now rejects SMTP/IMAP passwords in its config — the same
link-only contract the connectors got. A channel whose transport needs passwords is
created `active: false` and the response carries the one-time credential link; saving
the passwords through the link verifies them against the SMTP/IMAP servers (new
`verify` step on the channel credential handler) and activates the channel. A
`mailer`-outbound channel without IMAP needs no secrets and is active immediately.
The `/v1` dashboard path is unchanged.

The SMTP/IMAP probe moved from the email tools into a shared `EmailChannelProbe` so
the credential handoff and `conv_test_email_channel` run the same checks, and the
`setup-email-channel` skill is rewritten around the link flow.
