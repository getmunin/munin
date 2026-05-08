---
title: Handoff from an AI agent to a human
description: How an external chat-widget bot detects that a human/agent in Munin has replied and yields the conversation.
audiences: [admin]
---

# Handoff from an AI agent to a human

The chat-widget channel pushes transcripts into Munin in real time. Eventually a human (or a different Munin agent) replies via `conv_send_message`. The external bot needs to know so it stops responding.

## Mechanism: standard `conversation.message.sent` webhook

Munin emits this event whenever an `author_type` of `user`, `agent`, or `system` posts to a conversation. End-user messages instead fire `conversation.message.received`. Subscribe to `conversation.message.sent` on the customer's endpoint:

```
POST /api/v1/webhooks (admin)
{
  "url": "https://customer.example/munin-webhook",
  "events": ["conversation.message.sent"],
  "secret": "<32-byte-random>"
}
```

Munin signs each delivery with `X-Munin-Signature: sha256=<hmac>` over the raw body using the secret. Verify before trusting.

## Payload

```jsonc
{
  "type": "conversation.message.sent",
  "payload": {
    "conversationId": "ccv_…",
    "messageId":      "cvm_…",
    "authorType":     "user" | "agent" | "system",
    "internal":       false
  },
  "occurredAt": "2026-04-30T10:00:00Z"
}
```

The webhook intentionally does NOT include the message body — fetch via `conv_get_conversation` to get the latest state including the new message. This lets you trust your access control (the conversation's contact still matches the visitor's session).

## Recommended bot logic

1. On webhook receipt, look up `conversationId` in your bot's session store.
2. Call `conv_get_conversation` to read the new message (latest in the array).
3. Render it in the widget UI under the visitor's session.
4. Suppress the bot's automated replies for that session for some grace period (e.g. 30 minutes after the last `conversation.message.sent`).
5. If the visitor sends a new message, push it to Munin via the widget endpoint as usual. The human may decide to reply or hand back.

## Implicit handback

There's no explicit "the human is done" signal. If your bot has been quiet for the grace period and the visitor sends a fresh message, it can resume — Munin doesn't lock the bot out.

## What about `conversation.assigned` or `conversation.escalated`?

Munin doesn't emit those today. If you need a richer handoff state machine (out-of-office hours, explicit "transfer to bot"), file a feature request. The minimal contract is "human said something" → `conversation.message.sent`.

## Verifying the signature

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}
```
