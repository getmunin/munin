---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
'@getmunin/types': minor
---

SMS channels can set how the agent handles inbound texts

`defaultAgentMode` has always been a `conv_channels` column, but only the email path could write it — the vendor-backed path that creates every SMS channel had no way to set it, and neither did the dashboard. Every SMS number was stuck on `auto`, replying to inbound texts automatically.

It is now settable on SMS channels through `conv_configure_channel`, the vendor tools, the `/v1` SMS endpoints, and a control in the Twilio and MessageBird dialogs alongside the one email already had. Set `draft_only` on a number you only run campaigns from and inbound replies are drafted for approval instead of auto-answered.

Voice channels reject it with an explanation rather than accepting a value that would do nothing: an inbound call is run by the vendor's assistant, not by the Munin agent, so there is no reply for the mode to govern.

Also corrects `conv_create_channel`'s description, which claimed "the `voice` and `sms` channel types are reserved and not yet wired to an adapter". Both SMS vendors and both voice vendors have shipped adapters; those channels are created with `conv_configure_channel`, which the description now says.
