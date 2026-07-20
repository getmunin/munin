---
'@getmunin/backend-core': minor
---

Email channels can now use the credential-handoff flow: `conv_request_channel_credentials` (and `POST /v1/conversations/channels/:id/credential-link`) return a one-time dashboard link for entering a channel's SMTP/IMAP passwords, so secrets aren't pasted into an agent conversation. Create the channel with the password omitted, then share the link. Registers a `channel` handler on the shared credential-handoff registry.
