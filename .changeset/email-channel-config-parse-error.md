---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
---

Explain — and repair — an email channel whose stored config can't be parsed, instead of answering every save with a bare 500.

`jsonbToStored` parsed `conv_channels.config` with a bare `.parse()`, so a row whose saved config doesn't satisfy `StoredEmailChannelConfigSchema` threw a raw `ZodError` out of the handler. Nest turned that into an uninformative `Internal server error`, and because `updateChannel` parses the *existing* row before merging, the channel became uneditable: every attempt to fix it through the dashboard failed on the very thing the operator was trying to repair.

`jsonbToStored` now throws a `BadRequestException` carrying `code: 'conv_channel_config_invalid'`, the offending field paths, and a message that says what to do — so the dashboard shows a translated explanation and agents get a machine-readable string. More importantly, `updateChannel` now falls back to building the config from the submitted input when the stored one won't parse, so saving a complete configuration repairs the row rather than bouncing off it.
