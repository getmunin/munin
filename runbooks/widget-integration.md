# Chat-widget integration

Lets an external AI agent (Threll, custom GPT bot, etc.) running as a chat widget on a customer's website push transcripts into Munin's conversation module. Once the conversation is in Munin, a human in the dashboard can reply, and the customer's webhook receiver tells the external agent to step back.

## 1. Create the channel and mint a widget key

Authenticated as an admin (`mn_admin_*`), call the MCP tool:

```jsonc
{
  "name": "conv_widget_create_channel",
  "arguments": {
    "name": "storefront-bot",
    "displayName": "Storefront Bot",
    "originAllowlist": ["https://customer.example"]
  }
}
```

Response:

```jsonc
{
  "id": "cch_…",
  "name": "storefront-bot",
  "type": "chat",
  "active": true,
  "config": {
    "provider": "widget",
    "displayName": "Storefront Bot",
    "originAllowlist": ["https://customer.example"]
  },
  "widgetKey": "mn_widget_…"   // shown once — store it server-side
}
```

The widget key is bound to this channel via `api_keys.channel_id`. Rotate with `conv_widget_rotate_key`; update origins with `conv_widget_update_channel`.

## 2. Push transcripts from the agent

`POST /api/conv/widget/messages` — server-to-server is the recommended integration so the key never reaches browser JS.

```bash
curl -sS https://munin.example/api/conv/widget/messages \
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

Response:

```jsonc
{
  "conversationId": "ccv_…",
  "displayId": 7,
  "contactId": "ctc_…",
  "inserted": 2,
  "skipped": 0
}
```

### Conversation upsert

Conversations are keyed by `(orgId, channelId, metadata.sessionId)`. Sending the same `sessionId` again appends to the existing conversation; a new `sessionId` opens a new one.

### Idempotency

If you set `providerMessageId` on a message, replays of the same identifier are silently skipped (counted as `skipped`). Without `providerMessageId`, every POST inserts new rows — that's by design (the agent opts into idempotency by including the field).

### Visitor enrichment

`visitor.email` enables CRM linkage: the contact is matched on (org, email) and linked to any `end_users` row that already exists for that email. If you don't have an email, the contact is matched on `metadata.sessionId` so re-pushes update the same row. Once the visitor identifies themselves, send the email — Munin enriches the existing contact rather than creating a new one.

## 3. Receive replies from a human / Munin agent

When a Munin user replies in the conversation UI, `conversation.message.sent` fires on every webhook subscribed to that event. Subscribe your endpoint and:

1. Fetch the message via the standard MCP `conv_get_conversation` tool (or REST `/api/conv/conversations/:id`).
2. Render it in the customer-side widget UI.
3. Optionally signal your AI to step back so the human owns the thread.

This is the same webhook surface used elsewhere in Munin — no widget-specific events.

## 4. Browser-direct integration (optional, less secure)

If you must call the endpoint from browser JS (so the widget key reaches the page), the channel's `originAllowlist` reflects allowed `Origin` headers and the endpoint sets the matching `Access-Control-Allow-Origin`. Anyone on a listed origin can use the key; rotation is one MCP call. Server-side is strongly preferred.

## 5. Operations

| Task | How |
|---|---|
| Disable the channel | Set `conv_channels.active=false` (admin SQL or MCP). Existing keys still auth but ingest returns 403. |
| Rotate the widget key | `conv_widget_rotate_key` MCP tool. The old key is revoked; existing inflight requests with it 401. |
| Tighten `originAllowlist` | `conv_widget_update_channel` MCP tool. |
| Inspect a conversation | Standard dashboard / `conv_*` MCP tools. The `metadata.sessionId`, `metadata.providerMessageId`, and `metadata.url` fields tell you the visitor's session. |
