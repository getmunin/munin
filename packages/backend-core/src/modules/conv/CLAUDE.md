# Channel adapter contract

How to add a new conversation channel kind (SMS, voice, Slack, …) without forking the runtime. The pattern was extracted from the email implementation; widget is the second concrete adapter.

## The contract

`packages/backend-core/src/modules/conv/channels/adapter.ts` exports:

```ts
interface ChannelAdapter {
  readonly kind: ChannelKind;             // matches conv_channels.type
  send(ctx: SendContext): Promise<SendResult>;
  readonly inbound: InboundMode | null;
}

type InboundMode =
  | { mode: 'poll';    intervalMs: number; tick(channel): Promise<PollTickResult> }
  | { mode: 'webhook'; verify(req, channel): Promise<InboundBatch>; challenge?(req, channelId): WebhookResponse | null }
  | { mode: 'push' };                     // adapter exposes its own controller
```

Adapters are Nest providers registered via the multi-injection token `CHANNEL_ADAPTERS`. The `ConvModule` factory composes the array; downstream packages can extend it via the same `ADDITIONAL_*` extension pattern used for credential resolvers.

## Choose the right inbound mode

- **`poll`** — provider doesn't push to us; we fetch on a timer. Email IMAP is the canonical example. Per-channel cursor lives in `conv_inbound_state.cursor` (jsonb, adapter-defined shape).
- **`webhook`** — provider POSTs to `/v1/conversations/channels/:channelId/webhook`. Adapter's `verify` checks the signature (Twilio HMAC, Meta `X-Hub-Signature-256`, Telnyx Ed25519, …) and returns parsed messages. Best for SMS, WhatsApp, voice transcripts, Slack events.
  - A provider that verifies the callback URL with a GET handshake (Meta's `hub.challenge`) implements the optional `challenge(req, channelId)`. The controller's GET route calls it for the channel's adapter, or — when the channel row isn't visible, e.g. the vendor verifies the URL while the create transaction that inserted it is still open — for every adapter that has one. So `challenge` must decide from the request and the channel id alone (WhatsApp derives its verify token as an HMAC of the channel id with `MUNIN_KEY_PEPPER`) and never read the channel's stored config.
  - `verify` can also apply out-of-band updates itself — delivery statuses, read receipts, reactions — and return only the new messages. Read receipts go on `conv_message_deliveries.first_opened_at` / `last_opened_at` / `open_count` and emit `conversation.message.opened`, the same fields email opens use.
  - Inbound messages may carry `media: InboundMedia[]` (`{ name, fetch() }`) and extra `metadata`. `ChannelIngestService` fetches media outside the transaction, stores the bytes with `ConvAttachmentsService.storeBytes` **before** allocating a new conversation's display id (see `attachments/CLAUDE.md` for why), and records them on the message once it exists. Channel ingest accepts audio as well as images; client uploads stay images-only.
- **`push`** — caller is an authenticated agent that hits a public endpoint with a per-channel API key. Chat widget uses this. Adapter exposes its own `@Controller` (the runtime doesn't drive it); `inbound: { mode: 'push' }` just declares the mode.

## Author a new adapter — checklist

Mostly mechanical once you've picked an inbound mode.

1. **Pick the kind.** Add to the `ChannelKind` union if new (`'email' | 'chat' | 'sms' | 'voice' | 'whatsapp'` today). The string also goes into `conv_channels.type` for the channel rows.
2. **Channel config schema.** A Zod schema for the user-supplied config (provider, hostnames, allowlists, etc.). Encrypted secrets (SMTP passwords, OAuth tokens) go through pgcrypto via `@getmunin/core`'s `encryptSecretSql` / `decryptSecretSql`. See `email/email.service.ts` for the pattern.
3. **Implement `send(ctx)`.** Build the provider-shaped payload from `ctx.message`, send it, return `{ providerMessageId }`. The generic `OutboundDeliveryWorker` handles attempts, backoff, terminal `dead`, and the `conversation.message.delivered` / `conversation.message.delivery_failed` webhooks. Throw on transport failures; the worker counts and retries.
4. **Implement inbound:**
   - `poll`: `tick(channel)` reads `conv_inbound_state.cursor`, fetches from the provider, ingests messages (insert into `conv_messages` directly or via a service), writes back the new cursor + any error. The generic `InboundPollWorker` schedules ticks.
   - `webhook`: `verify(req, channel)` rejects unsigned/invalid requests and returns an `InboundBatch`. The generic webhook controller persists each message via the same path used elsewhere (TBD: a shared `ingestMessage` helper).
   - `push`: write a controller. Authenticate via existing `AuthGuard` + a new key kind (e.g. `mn_widget_*`). Use `@UseGuards(AuthGuard) @UseInterceptors(TenancyInterceptor, AuditInterceptor)` so tenancy GUCs are set.
5. **Register.** Add the adapter class to `ConvModule`'s providers and to the `CHANNEL_ADAPTERS` factory:
   ```ts
   { provide: CHANNEL_ADAPTERS,
     useFactory: (email: EmailAdapter, sms: SmsAdapter) => [email, sms],
     inject: [EmailAdapter, SmsAdapter] }
   ```
6. **MCP admin tools.** Mirror `email.tools.ts`. Audience `'admin'`, scope `'conv:write'`, and name them by the rules in *Naming the provisioning tools* below — `conv_configure_<kind>_channel` for an upsert, `conv_create_<kind>_channel` + `conv_update_<kind>_channel` when create mints a key. Secret fields are rejected at the tool boundary (`rejectSecrets: true`); the channel is created inactive and the response carries a one-time credential link.
7. **Tests.** One integration test gated on `TEST_DATABASE_URL`. Cover:
   - Channel create + key mint via MCP.
   - Inbound: stub the provider boundary (poll fetcher, webhook verifier, push request), assert conv/contact/message rows appear.
   - Outbound: enqueue a `conv_message_deliveries` row, run `OutboundDeliveryWorker.tick()`, assert success.
   - RLS isolation (provider for org A can't see / write to org B's channel).

## Naming the provisioning tools

The verb says what the tool's shape is, not which channel family it serves:

| Tool | `channelId` | Shape |
|---|---|---|
| `conv_configure_email_channel` | optional | upsert — omit to create, pass to update |
| `conv_configure_voice_sms_channel` | optional | upsert |
| `conv_create_widget_channel` / `conv_update_widget_channel` | absent / required | separate create and update |

`configure` means one tool that creates or updates. 4.76.0 unified the verbs for that shape (`conv_setup_email_channel` → `conv_configure_email_channel`, matching voice/SMS) after three verbs — `create`, `setup`, `configure` — had come to mean the same action across three families.

Widget keeps a split pair because its create is not idempotent: it mints an `mn_widget_*` key and an identity-verification secret that are returned exactly once, so an upsert would change its return shape depending on whether `channelId` was passed, and a re-call would be ambiguous about whether to rotate the key. Rotation is explicit instead (`conv_rotate_widget_key`, `conv_rotate_widget_identity_secret`). Email and voice/SMS creates also hand back something one-time — a credential link — but that link is re-mintable at will via `conv_request_channel_credentials` and is not itself the secret, so create and update stay one tool.

So: **upsert under `configure` only when create and update are the same write.** If create mints a credential, give it its own `create`, an `update` beside it, and explicit rotate tools. The root `CLAUDE.md` tool checklist carries the same rule.

## What NOT to do

- Don't reinvent the cursor table. `conv_inbound_state` is shared. Pick a jsonb shape (`{ lastUid }`, `{ lastWebhookId }`, …) and stay there.
- Don't insert into `conv_message_deliveries` from the inbound path. Deliveries are outbound only.
- Don't carry secrets in `conv_channels.config` as plaintext. Always pgcrypto-wrap them and surface a `password: REDACTED` DTO.
- Don't add a new global webhook event for handoff/escalation unless there's no existing event that fits. `conversation.message.sent` covers most cases.

## Related

- `packages/backend-core/src/modules/conv/email/email-adapter.ts` — reference implementation for `poll` + outbound SMTP.
- `packages/backend-core/src/modules/conv/widget/` — reference implementation for `push`.
- `packages/backend-core/src/modules/conv/whatsapp/` — reference implementation for `webhook` with a GET challenge, signed JSON payloads, status/read/reaction updates, inbound media, and a channel-specific send rule (the 24-hour customer-service window, enforced in `ConvService.sendMessage` before anything is queued).
