---
title: Conv: Set up a chat widget
description: Provision a per-channel widget API key, push transcripts via POST /v1/widget/messages, and wire the human-handoff webhook.
audiences: [admin]
---

# Set up a chat widget
Lets an external AI agent running as a chat widget on a customer's website push transcripts into Munin's conversation module. Once the conversation is in Munin, a human in the dashboard can reply, and the customer's webhook receiver tells the external agent to step back.

## 1. Create the channel and mint a widget key

Call `conv_widget_create_channel`:

```jsonc
{
  "name": "storefront-bot",
  "originAllowlist": ["https://customer.example"]
}
```

Response includes `widgetKey: "mn_widget_…"` — shown once. Store it server-side.

`originAllowlist` is required — the widget ingest endpoint rejects any request whose `Origin` header doesn't match one of the listed full origins (scheme + host + port, exact match). List every environment that should be allowed to ingest (`https://customer.example`, `https://staging.customer.example`, etc.).

The widget key is bound to this channel via `api_keys.channel_id`. Rotate with `conv_widget_rotate_key`; update origins with `conv_widget_update_channel`.

## 2. Push transcripts from the agent

`POST /v1/widget/messages` — server-to-server is the recommended integration so the key never reaches browser JS.

```bash
curl -sS https://munin.example/v1/widget/messages \
  -H "Authorization: Bearer $MUNIN_WIDGET_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "channelId": "cch_…",
    "sessionId": "vis_abc123",
    "visitor": { "name": "Vita", "email": "vita@example.com" },
    "url": "https://customer.example/checkout",
    "messages": [
      { "role": "end_user", "body": "Where is my order?", "providerMessageId": "evt_1" },
      { "role": "agent",     "body": "Let me check…",      "providerMessageId": "evt_2" }
    ]
  }'
```

Response: `{ conversationId, displayId, contactId, inserted, skipped }`.

### Conversation upsert

Conversations are keyed by `(orgId, channelId, metadata.sessionId)`. Sending the same `sessionId` again appends to the existing conversation; a new `sessionId` opens a new one.

### Idempotency

If you set `providerMessageId` on a message, replays of the same identifier are silently skipped (counted as `skipped`). Without `providerMessageId`, every POST inserts new rows — that's by design (the agent opts into idempotency by including the field).

### Visitor enrichment

`visitor.email` enables CRM linkage: the contact is matched on (org, email). If you don't have an email, the contact is matched on `metadata.sessionId` so re-pushes update the same row. Once the visitor identifies themselves, send the email — the existing contact gets enriched rather than duplicated.

## 3. Receive replies from a human / Munin agent

When a Munin user replies in the conversation UI, `conversation.message.sent` fires on every webhook subscribed to that event. Subscribe your endpoint and:

1. Fetch the message via the standard `conv_get_conversation` tool.
2. Render it in the customer-side widget UI.
3. Optionally signal your AI to step back so the human owns the thread.

Same webhook surface used elsewhere in Munin — no widget-specific events.

## 4. Verified identity (optional)

By default widget visitors are anonymous — contacts are keyed on `metadata.sessionId` (or `visitor.email` if sent). To tie a widget session to a *known* user (and gate anonymous access), attach a signed identity: a `verifiedExternalId` + `userHash` pair the ingest endpoint verifies against the channel's identity-verification secret.

`conv_widget_create_channel` returns `identityVerificationSecret` once (alongside `widgetKey`). Treat it like an OAuth client secret — store it server-side, never embed it in browser JS. Rotate with `conv_widget_rotate_identity_secret` (previously-issued hashes stop verifying immediately). This is a **separate secret from the analytics tracker's** — sign widget hashes with the widget channel's secret, never the tracker secret.

Compute the hash server-side:

```ts
import { createHmac } from 'node:crypto';

function userHash(externalId: string, secret: string): string {
  return createHmac('sha256', secret).update(externalId).digest('hex');
}
```

The widget hash covers `externalId` **only** — no visitor binding. That's a deliberate contrast with the analytics tracker, whose identify hash binds the visitor (`HMAC(\`${externalId}:${visitorId}\`)`, see `skill://analytics/identify-visitors`) and therefore needs a per-session browser round-trip. Because the widget hash is static per user, you can **server-render it** into the embed with no round-trip:

```html
<script async
  src="https://munin.example/widget.js"
  data-widget-key="mn_widget_…"
  data-channel-id="cch_…"
  data-external-id="user_42"
  data-user-hash="<hex hmac from above>">
</script>
```

`data-external-id` and `data-user-hash` are all-or-nothing: sending one without the other is rejected (`identity_partial`). Render them only for signed-in users; omit both for anonymous visitors. (On browser-direct calls, the same values are passed as the `verifiedExternalId` + `userHash` params.)

Set `requireVerifiedIdentity: true` on the channel (`conv_widget_create_channel` / `conv_widget_update_channel`) to reject unverified sessions outright; the default (`false`) allows anonymous ingest alongside verified ones.

Because the widget and the analytics tracker share the same `localStorage` visitor id (`mn.vid`), identifying a visitor to the widget also stitches their prior anonymous analytics history — no separate `window.mn.identify` call needed for that visitor.

## 5. Browser-direct integration (less secure)

If you must call the endpoint from browser JS, the channel's `originAllowlist` reflects allowed `Origin` headers and the endpoint sets the matching `Access-Control-Allow-Origin`. Anyone on a listed origin can use the key; rotation is one tool call. Server-side is strongly preferred.

## 6. Operations

| Task | How |
|---|---|
| Disable the channel | Set `conv_channels.active=false`. Existing keys still auth but ingest returns 403. |
| Rotate the widget key | `conv_widget_rotate_key`. Old key revoked; existing inflight requests with it 401. |
| Rotate the identity secret | `conv_widget_rotate_identity_secret`. Previously-issued `data-user-hash` values stop verifying; re-render signed-in pages with freshly-computed hashes. |
| Tighten `originAllowlist` | `conv_widget_update_channel`. |
| Inspect a conversation | Standard `conv_*` tools. The `metadata.sessionId`, `metadata.providerMessageId`, and `metadata.url` fields tell you the visitor's session. |
