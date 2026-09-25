---
"@getmunin/backend-core": patch
"@getmunin/core": patch
"@getmunin/chat-widget": patch
---

Keep the Vapi webhook secret server-side and bind in-browser voice calls to their conversation.

In-browser voice calls used to receive a full copy of the Vapi assistant config, including the assistant's server settings, where the webhook secret Munin authenticates Vapi webhooks with is stored. `voice/start` now starts the stored assistant by id and sends only the per-call overrides (model, messages, tools). Server settings never reach the browser, and neither do assistant tools that carry their own server or credential config.

The conversation id in a call's metadata used to be trusted as sent. Each call now carries a short-lived token that Munin signs over the org, voice channel, conversation and end user. Tool calls, transcripts and end-of-call reports whose token is missing, doesn't verify, or doesn't match are no longer attached to an existing conversation. Tool calls also refuse to run when the token's end user no longer owns the conversation. Inbound phone calls get the same signed token from the assistant-request response.

Rotating the webhook secret now updates the assistant too. Whether it arrives through the dashboard or a `conv_request_channel_credentials` link, a new secret for a channel whose assistant webhook Munin configured is written to the assistant first. If that write fails, nothing is saved, so Vapi is never left sending a secret Munin has stopped accepting.

**Action for operators:** rotate the webhook secret on every existing Vapi voice channel that has a public key set (in-browser voice). Treat the old secret as exposed.
