---
title: Conv: Set up a chat widget
description: Provision a per-channel widget API key, push transcripts via POST /api/v1/widget/messages, and wire the human-handoff webhook.
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

The widget key is bound to this channel via `api_keys.channel_id`. Rotate with `conv_widget_rotate_key`; update origins with `conv_widget_update_channel`.

## 2. Push transcripts from the agent

`POST /api/v1/widget/messages` — server-to-server is the recommended integration so the key never reaches browser JS.

```bash
curl -sS https://munin.example/api/v1/widget/messages \
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

## 4. Browser-direct integration (less secure)

If you must call the endpoint from browser JS, the channel's `originAllowlist` reflects allowed `Origin` headers and the endpoint sets the matching `Access-Control-Allow-Origin`. Anyone on a listed origin can use the key; rotation is one tool call. Server-side is strongly preferred.

## 5. Operations

| Task | How |
|---|---|
| Disable the channel | Set `conv_channels.active=false`. Existing keys still auth but ingest returns 403. |
| Rotate the widget key | `conv_widget_rotate_key`. Old key revoked; existing inflight requests with it 401. |
| Tighten `originAllowlist` | `conv_widget_update_channel`. |
| Inspect a conversation | Standard `conv_*` tools. The `metadata.sessionId`, `metadata.providerMessageId`, and `metadata.url` fields tell you the visitor's session. |
