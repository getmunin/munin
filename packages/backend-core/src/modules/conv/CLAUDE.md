# Channel adapter contract

How to add a new conversation channel kind (SMS, voice, Slack, …) without forking the runtime. The pattern was extracted from the email implementation; widget is the second concrete adapter.

## The contract

`packages/backend-core/src/modules/conv/channels/adapter.ts` exports:

```ts
interface ChannelAdapter {
  readonly kind: ChannelKind;             // matches conv_channels.type
  readonly vendors: readonly string[];    // registry key is `${kind}:${vendor}`
  readonly outboundDelivery: 'queued' | 'none';
  send(ctx: SendContext): Promise<SendResult>;
  readonly inbound: InboundMode | null;
}

type InboundMode =
  | { mode: 'poll';    intervalMs: number; tick(channel): Promise<PollTickResult> }
  | { mode: 'webhook'; verify(req, channel): Promise<InboundBatch> }
  | { mode: 'push' };                     // adapter exposes its own controller
```

`outboundDelivery` is what decides whether an outbound message gets a
`conv_message_deliveries` row at all. `ConvService` asks the registry
(`deliversOutbound(type, vendor)`); it used to consult a hardcoded
`DELIVERABLE_CHANNEL_TYPES = ['email','sms']` list, which could not express
"chat:reddit is queued but chat:munin is not" — the widget's `send()` is a
no-op stub because the browser polls, so queueing for it would fire bogus
`conversation.message.delivered` webhooks. Declare `'none'` when your channel's
egress happens somewhere other than the delivery worker (widget, voice).

Adapters are Nest providers registered via the multi-injection token `CHANNEL_ADAPTERS`. The `ConvModule` factory composes the array; downstream packages can extend it via the same `ADDITIONAL_*` extension pattern used for credential resolvers.

## Choose the right inbound mode

- **`poll`** — provider doesn't push to us; we fetch on a timer. Email IMAP is the canonical example. Per-channel cursor lives in `conv_inbound_state.cursor` (jsonb, adapter-defined shape).
- **`webhook`** — provider POSTs to `/v1/conversations/channels/:channelId/webhook`. Adapter's `verify` checks the signature (Twilio HMAC, Telnyx Ed25519, …) and returns parsed messages. Best for SMS, voice transcripts, Slack events.
- **`push`** — caller is an authenticated agent that hits a public endpoint with a per-channel API key. Chat widget uses this. Adapter exposes its own `@Controller` (the runtime doesn't drive it); `inbound: { mode: 'push' }` just declares the mode.

## Author a new adapter — checklist

Mostly mechanical once you've picked an inbound mode.

1. **Pick the kind.** Add to the `ChannelKind` union if new (`'email' | 'chat' | 'sms' | 'voice'` today). The string also goes into `conv_channels.type` for the channel rows.
2. **Channel config schema.** A Zod schema for the user-supplied config (provider, hostnames, allowlists, etc.). Encrypted secrets (SMTP passwords, OAuth tokens) go through pgcrypto via `@getmunin/core`'s `encryptSecretSql` / `decryptSecretSql`. See `email/email.service.ts` for the pattern.
3. **Implement `send(ctx)`.** Build the provider-shaped payload from `ctx.message`, send it, return `{ providerMessageId }`. The generic `OutboundDeliveryWorker` handles attempts, backoff, terminal `dead`, and the `conversation.message.delivered` / `conversation.message.delivery_failed` webhooks. Throw on transport failures; the worker counts and retries (5 attempts, 30s × 2ⁿ backoff).

   Two failures are not ordinary transport failures, and blind retrying makes both worse. `channels/send-outcome.ts` lets the adapter say so:

   - `ChannelSendTerminalError` — the provider rejected this send for a reason no retry can fix (recipient blocked us, thread locked, account suspended, no address on the contact). The delivery goes `dead` on the first attempt and `delivery_failed` fires immediately, instead of hammering a possibly-burned account four more times.
   - `ChannelSendDeferredError(message, nextAttemptAt)` — the provider told us when to come back (HTTP 429 + `Retry-After`, an `X-Ratelimit-Reset`). The delivery is re-queued for that moment **without consuming an attempt**, so a rate limit can never exhaust the retry budget.

   Watch for providers that report failure with a 200 and an error body (Reddit's `{ json: { errors: [...] } }`) — status alone is not the signal.

   For steady-state pacing use the existing per-channel limiter instead: put `sendLimits: { perHourMax, perDayMax }` at the top level of your stored config and `OutboundDeliveryWorker` applies a sliding window before calling `send` at all. Don't write a second limiter inside an adapter.
4. **Decide how a message identifies its sender and its thread.** `InboundBatch` carries both:

   - `fromIdentity: { email?, phone?, name?, handle? }`. `handle` is a platform username stored bare (no `u/`, no `@`) in `conv_contacts.handle` / `crm_contacts.handle`, indexed per org. `ChannelIngestService` resolves email → phone → handle, and namespaces the `end_users.externalId` it mints as `` `${channel.vendor}:${handle}` `` so the same username on two platforms is two people.
   - `conversationKey?: string`. By default a conversation is keyed on *who wrote it* (org, channel, contact), which is right for email/SMS/DM but wrong for a forum thread, where many people talk in one place. Set `conversationKey` and ingest resolves on `(org, channel, metadata->>'conversationKey')` instead — unique index `conv_conversations_conversation_key_uq`, reopened if closed. A keyed message **never** falls back to contact-threading, so one redditor's DM and their reply in a thread stay in separate conversations. `conv_messages.authorId` is per-message, so a keyed conversation is naturally multi-author.

   Use a stable, namespaced key: `reddit:thread:<id>`, not the bare id.

5. **Implement inbound:**
   - `poll`: `tick(channel)` reads `conv_inbound_state.cursor`, fetches from the provider, ingests messages (insert into `conv_messages` directly or via a service), writes back the new cursor + any error. The generic `InboundPollWorker` schedules ticks.
   - `webhook`: `verify(req, channel)` rejects unsigned/invalid requests and returns an `InboundBatch`. The generic webhook controller persists each message via the same path used elsewhere (TBD: a shared `ingestMessage` helper).
   - `push`: write a controller. Authenticate via existing `AuthGuard` + a new key kind (e.g. `mn_widget_*`). Use `@UseGuards(AuthGuard) @UseInterceptors(TenancyInterceptor, AuditInterceptor)` so tenancy GUCs are set.
6. **Register.** Add the adapter class to `ConvModule`'s providers and to the `CHANNEL_ADAPTERS` factory:
   ```ts
   { provide: CHANNEL_ADAPTERS,
     useFactory: (email: EmailAdapter, sms: SmsAdapter) => [email, sms],
     inject: [EmailAdapter, SmsAdapter] }
   ```
7. **MCP admin tools.** Mirror `email.tools.ts`: `conv_<kind>_setup_channel`, `conv_<kind>_rotate_key` (if push-mode keys), etc. Audience `'admin'`, scope `'conv:write'`.
8. **Tests.** One integration test gated on `TEST_DATABASE_URL`. Cover:
   - Channel create + key mint via MCP.
   - Inbound: stub the provider boundary (poll fetcher, webhook verifier, push request), assert conv/contact/message rows appear.
   - Outbound: enqueue a `conv_message_deliveries` row, run `OutboundDeliveryWorker.tick()`, assert success.
   - RLS isolation (provider for org A can't see / write to org B's channel).

## What NOT to do

- Don't reinvent the cursor table. `conv_inbound_state` is shared. Pick a jsonb shape (`{ lastUid }`, `{ lastWebhookId }`, …) and stay there.
- Don't insert into `conv_message_deliveries` from the inbound path. Deliveries are outbound only.
- Don't carry secrets in `conv_channels.config` as plaintext. Always pgcrypto-wrap them and surface a `password: REDACTED` DTO.
- Don't add a new global webhook event for handoff/escalation unless there's no existing event that fits. `conversation.message.sent` covers most cases.

## Related

- `packages/backend-core/src/modules/conv/email/email-adapter.ts` — reference implementation for `poll` + outbound SMTP.
- `packages/backend-core/src/modules/conv/widget/` — reference implementation for `push`.
