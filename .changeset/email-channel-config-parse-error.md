---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
---

Stop returning bare 500s when a channel's stored config can't be parsed, and let a full save repair it.

Every channel service parsed `conv_channels.config` with a bare `.parse()`, so a row that doesn't satisfy its stored schema threw a raw `ZodError` out of the handler and surfaced as an uninformative `Internal server error`. `ConvService.importConv` writes `config: {}` on every imported channel by design — the operator is told to "re-enter them on this server" — so the documented recovery path ran straight into this.

Stored configs now go through a shared `parseStoredConfig`, which throws a transport-free `ChannelConfigInvalidError` carrying `code: 'conv_channel_config_invalid'` and the offending field paths. A controller-scoped interceptor maps it to a **500** at the HTTP boundary: a corrupt stored config is a server-side fault the caller cannot fix by changing the request, which is the same split `nestjs-zod` makes between request validation (400) and server-side serialization failures (500). The MCP dispatcher already surfaces the message, so agents get the coded string and the dashboard translates via `code`. Applied to all five channel kinds — email, Vapi, Twilio, MessageBird and Threll.

`EmailService.updateChannel` additionally falls back to building the config from the submitted input when the stored one won't parse, so saving a complete configuration repairs the row instead of bouncing off it. The vendor services deliberately do not get that fallback: their merges read `input.config?.x ?? prev.x`, so rebuilding from a partial input would silently drop settings — they surface the error instead.

Separately, the four vendor admin providers parsed *incoming* config with a bare `ConfigSchema.parse(input.config)`, turning ordinary bad input into a 500 as well. That boundary is genuinely client-side, so it now throws a `400` naming the offending fields, matching the `validatePendingConfig` helper already sitting a few lines below each one.
