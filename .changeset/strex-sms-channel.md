---
'@getmunin/backend-core': minor
'@getmunin/types': minor
'@getmunin/dashboard-pages': minor
---

Conversations: Strex (Target365) as a third SMS vendor, for Norwegian short numbers.

- `conv_configure_voice_sms_channel` accepts `vendor: "strex"` with `sender`, an optional `shortNumberId` (e.g. `NO-2002`), an optional `keyword`, and `environment` (`production` or `test`). The Strex Connect API key arrives through the credential link like every other vendor secret, and requests authenticate with the `X-ApiKey` header.
- Replies need no setup in Strex Connect. Once the API key is saved, Munin registers a keyword on the short number that forwards inbound texts to the channel: a `Wildcard` catch-all on a dedicated number, or an `Exact` first-word match when `keyword` is set for a shared one. An existing keyword that already forwards to the channel is reused, and one that forwards elsewhere is refused with `strex_keyword_conflict` instead of being taken over. Changing the route registers the new keyword before deleting the old one, `shortNumberId: null` makes the channel outbound-only, and archiving the channel deletes its keyword.
- Inbound texts and delivery reports share the channel webhook. Each one is verified against the `X-ECDSA-Signature` header: an ECDSA P-256 signature over the method, the lowercased URL, a timestamp inside a five-minute window, a nonce and the body hash, checked against the Strex server key fetched by name and cached per process. The webhook answers `200`, which is what Strex retries on.
- Outbound texts use the delivery id as the Strex `transactionId`, so a send the worker retries after a timeout cannot go out twice. Strex reports such a retry as `DuplicateTransaction`, and that report is ignored, so it cannot mark an already delivered message as failed. `Ok` and `Sent` reports mark the delivery sent, and `Failed` marks it failed with the detailed status as the error (`strex_SubscriberBarred`).
- `InboundBatch` messages can carry `optOut: true`. Strex sets `isStopMessage` on texts like `STOPP ACME` on a shared number, which the bare opt-out keyword match would miss, and those texts now suppress the CRM contact the same way.
- `conv_test_voice_sms_channel` checks the API key and reports whether the inbound keyword is still registered, enabled and forwarding to Munin. `conv_send_sms_channel_test` sends a real text.
- Dashboard: Strex is an option in the add-SMS dialog, with edit and send-test dialogs, in English and Norwegian. `ConfigureStrexSmsBody` and `SendStrexSmsTestBody` are exported from `@getmunin/types` for the matching `/v1/conversations/channels/strex-sms` routes.
- `skill://conv/setup-voice-sms-channel` covers when a Strex sender can receive replies, dedicated versus shared short numbers, and the keyword conflict.
