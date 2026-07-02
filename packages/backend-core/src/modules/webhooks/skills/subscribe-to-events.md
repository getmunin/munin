---
title: 'Webhooks: Subscribe to events'
description: Get events POSTed to an HTTPS endpoint when things happen in Munin (a CMS entry publishes, a conversation message lands, a deal advances) — wire up a signed receiver, verify signatures correctly, and handle retries idempotently.
audiences: [admin]
---

# Subscribe to events
Webhooks let your stack react to Munin events without polling. When something happens in Munin, Munin POSTs a signed JSON payload to an HTTPS URL you control — no mobile/browser push, no message broker, just an HTTP request. Use them when something *outside* Munin needs to know: rebuild a static site when a CMS entry publishes, forward a human reply into your chat widget UI, sync a CRM contact to your warehouse, ping Slack on a critical conversation.

If you find yourself thinking "I'll poll the API every 30 seconds," subscribe instead.

## TL;DR

1. Pick the events you care about (`webhooks_list_event_types` for the catalog).
2. `webhooks_create` — get back a one-time `whsec_…` secret. Store it server-side.
3. Implement an HTTPS receiver: verify `x-munin-signature`, ack with 2xx fast, do work async.
4. Test with a real event; inspect `webhooks_list_deliveries` for the audit trail.
5. Rotate the secret periodically via `webhooks_rotate_secret`.

## 1. Pick events

```jsonc
{ "name": "webhooks_list_event_types", "arguments": {} }
```

Returns event type strings grouped by module. The catalog at time of writing:

- **CMS** — `cms.collection.created`, `cms.collection.fields_changed`, `cms.entry.created`, `cms.entry.updated`, `cms.entry.published`, `cms.entry.unpublished`, `cms.entry.scheduled`, `cms.entry.deleted`
- **Conv** — `conversation.created`, `conversation.status_changed`, `conversation.assigned`, `conversation.released`, `conversation.taken_over`, `conversation.agent_mode_changed`, `conversation.handover_requested`, `conversation.handover_resolved`, `conversation.greet_requested`, `conversation.message.received`, `conversation.message.sent`, `conversation.voice.call_ended`
- **CRM** — `crm.contact.created`, `crm.contact.updated`, `crm.company.created`, `crm.deal.created`, `crm.deal.stage_changed`, `crm.activity.logged`, `crm.merge_proposal.proposed`
- **KB** — `kb.document.created`, `kb.document.updated`, `kb.document.deleted`
- **Outreach** — `outreach.proposal.created`, `outreach.proposal.updated`, `outreach.proposal.sent`, `outreach.proposal.dismissed`
- **System** — `org_alert.opened`, `org_alert.acknowledged`, `org_alert.resolved`, `curator_job.pending`

The subscription accepts **arbitrary strings**, so future events work without a tool update. But subscribe to the specific events you handle, not "everything" — narrow subscriptions reduce noise, signature-verification CPU, and your receiver's failure surface.

## 2. Create the subscription

```jsonc
{
  "name": "webhooks_create",
  "arguments": {
    "url": "https://your-backend.example.com/munin/webhook",
    "events": ["conversation.message.sent", "cms.entry.published"]
  }
}
```

Response (the only time the secret is shown):

```jsonc
{
  "id": "wh_…",
  "url": "https://your-backend.example.com/munin/webhook",
  "events": ["conversation.message.sent", "cms.entry.published"],
  "secret": "whsec_…",
  "active": true
}
```

Rules:

- **`url` must be `https://`**. The MCP tool refuses anything else. There is no per-environment "allow http in dev" toggle.
- **`events` can be omitted or empty** to subscribe to all events emitted by your org. Prefer the explicit list — every event you don't actually handle is a wasted POST and a wasted signature verification.
- **The secret is shown once.** If you didn't capture it, `webhooks_rotate_secret({id})` mints a new one (and invalidates the old).

## 3. Implement the receiver

### Wire shape

Munin POSTs JSON to your URL. Headers:

| Header | Value |
|---|---|
| `content-type` | `application/json` |
| `x-munin-event` | The event type string (e.g. `conversation.message.sent`). |
| `x-munin-delivery-id` | UUID for this delivery attempt. Stable across retries of the same event. Use it for idempotency. |
| `x-munin-timestamp` | Unix seconds when the delivery was signed. Part of the signed payload — check it against a freshness window to reject replays. |
| `x-munin-signature` | `sha256=<hex>` — HMAC-SHA256 of `<x-munin-timestamp>.<rawBody>` using your secret. |

Body shape:

```jsonc
{
  "type": "conversation.message.sent",
  "id": "evt_…",
  "orgId": "org_…",
  "correlationId": "…",
  "createdAt": "2026-06-08T13:42:11.000Z",
  "payload": { /* event-specific */ }
}
```

### Signature verification (the only thing you can't skip)

Check `x-munin-timestamp` against a freshness window first, then compute `HMAC-SHA256(`${timestamp}.${rawBody}`, secret)`, prefix `sha256=`, and compare to `x-munin-signature` using a **constant-time** comparison. Never use `===` for the comparison itself — leak the timing and an attacker can forge signatures.

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_SKEW_SECONDS = 5 * 60;

function verifyMuninSignature(
  rawBody: string,
  timestamp: string,
  header: string,
  secret: string,
): boolean {
  const age = Math.floor(Date.now() / 1000) - Number(timestamp);
  if (!Number.isFinite(age) || Math.abs(age) > MAX_SKEW_SECONDS) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

Critical points:

- **Verify against the raw body bytes**, not a re-stringified parsed JSON. `JSON.parse` then `JSON.stringify` changes key order, whitespace, and number formatting — the signature won't match. Frameworks that parse the body before your handler must give you the original buffer (Express: `express.raw({ type: 'application/json' })`; Next.js route handler: `await req.text()`; Fastify: `addContentTypeParser('application/json', { parseAs: 'buffer' }, …)`).
- **Reject stale timestamps.** The `x-munin-timestamp` is inside the signed payload, so an attacker can't rewrite it without breaking the signature — but you must actually check it against a window (a few minutes) or a captured delivery replays forever.
- If verification fails, return **`401`** without revealing why. No "bad signature" / "missing header" distinction in the response body.

### Idempotency

Munin retries on non-2xx — up to **5 attempts**, exponential backoff starting at **30s** (30s → 1m → 2m → 4m → 8m, ~16 minutes total). Retries reuse the same `x-munin-delivery-id`.

Persist `x-munin-delivery-id` for at least the retry window and short-circuit duplicates:

```ts
if (await deliveriesTable.exists(deliveryId)) return res.status(200).end();
await deliveriesTable.insert(deliveryId, createdAt: new Date());
```

A unique constraint on `delivery_id` and an `ON CONFLICT DO NOTHING` works fine — you don't need a separate seen-set table.

### Ack fast, work later

Munin's HTTP client times out at **15 seconds**. If your handler does heavy work synchronously (regenerating a static site, sending an email, querying a slow upstream), the connection will be aborted and Munin will retry — possibly many times before the work actually completes.

Pattern: verify → idempotency-check → enqueue → 200. Then process the queue separately.

```ts
app.post('/munin/webhook', async (req, res) => {
  const raw = req.rawBody;
  if (
    !verifyMuninSignature(
      raw,
      req.header('x-munin-timestamp'),
      req.header('x-munin-signature'),
      SECRET,
    )
  ) {
    return res.status(401).end();
  }
  const deliveryId = req.header('x-munin-delivery-id');
  if (await alreadyHandled(deliveryId)) return res.status(200).end();
  const event = JSON.parse(raw);
  await queue.enqueue({ deliveryId, event });
  res.status(200).end();
});
```

For the handful of cases where the work *is* fast (write one row, push one cache-busting URL), inline it. But ack inside 5 seconds.

## 4. Common patterns

### Human reply → chat widget UI

When a human agent replies in the Munin dashboard, the widget's frontend doesn't poll. Your server subscribes to `conversation.message.sent`, receives the POST, then forwards the message to the visitor over your own real-time channel (SSE, WebSocket, Pusher) keyed by `payload.conversationId` (or `metadata.sessionId`, depending on how you correlate).

Pair this with `skill://playbooks/frontend-integration` — the widget tells you which `sessionId` a visitor is on; the webhook tells you when there's something new for that session.

### CMS publish → static site rebuild

Subscribe to `cms.entry.published`, `cms.entry.unpublished`, `cms.entry.deleted`. On receipt: trigger your build system's deploy hook (`fetch('https://api.vercel.com/v1/integrations/deploy/…', { method: 'POST' })` or equivalent). Filter by `payload.collectionSlug` if you only want to rebuild on certain content types.

ISR / on-demand revalidation is the lighter-weight alternative — just revalidate the affected paths instead of a full rebuild.

### Deal stage change → Slack

Subscribe to `crm.deal.stage_changed`. Look at `payload.fromStage` / `payload.toStage`. Filter for stages you care about (e.g. anything → "Closed Won") and post into a sales channel. Skip the others server-side rather than subscribing to everything and discarding.

## 5. Operations

```jsonc
{ "name": "webhooks_list", "arguments": {} }
```
Returns all subscriptions with `id`, `url`, `events`, `active`, but no `secret` (it's not stored in retrievable form — only the hash).

```jsonc
{
  "name": "webhooks_list_deliveries",
  "arguments": { "webhookId": "wh_…", "status": "failed", "limit": 50 }
}
```
Per-delivery audit: `attempt`, `statusCode`, `durationMs`, `error`, `deliveredAt`, `nextAttemptAt`, rolled-up `status`. Use this to debug 4xx/5xx receivers without changing log levels.

```jsonc
{ "name": "webhooks_rotate_secret", "arguments": { "id": "wh_…" } }
```
Returns the new `whsec_…`. The previous secret stops signing **immediately** — update your receiver's stored secret first, *then* call rotate, or coordinate a brief overlap by keeping both secrets and accepting either.

```jsonc
{
  "name": "webhooks_update",
  "arguments": {
    "id": "wh_…",
    "patch": { "events": ["conversation.message.sent", "conversation.message.received"] }
  }
}
```
`events` replaces the array — read the current list first if you're appending, not overwriting.

```jsonc
{ "name": "webhooks_delete", "arguments": { "id": "wh_…" } }
```
Cascade-deletes pending deliveries. In-flight attempts finish their current run; the next scheduled retry is dropped.

## What NOT to do

- **Don't skip signature verification "just for now."** Webhook URLs are typically discoverable (subdomain enumeration, logs, GitHub leaks). An unsigned receiver lets anyone trigger arbitrary side effects. There is no "test mode" that skips signing — every delivery is signed.
- **Don't compare signatures with `===`.** Timing leak. Use `crypto.timingSafeEqual` after a length check.
- **Don't re-serialize the body before verifying.** `JSON.parse` then `JSON.stringify` changes the bytes; the signature won't match. Verify against the raw bytes Munin sent.
- **Don't ack non-2xx and assume "Munin will retry later".** It will — five times — and then mark the delivery permanently failed. After that the event is gone unless you have your own replay path. Better to ack 200 (queue-and-handle) than 500 (drop after retries exhausted).
- **Don't subscribe to events you don't handle.** Each unwanted POST burns your receiver's CPU on signature verification and adds noise to `webhooks_list_deliveries`. Subscribe narrowly.
- **Don't store the secret in client-side JS.** It's a server-side secret — exposing it lets anyone forge events. The receiver runs on your server; the secret stays there.

## Related

- `webhooks_list_event_types` — canonical event catalog (always reflects what's actually emitted).
- `skill://playbooks/frontend-integration` — companion playbook; webhooks are how the widget UI learns about human replies.
- `skill://conv/setup-chat-widget` — `conversation.message.sent` is the event paired with browser-side rendering.
- `skill://cms/publish-entry` — `cms.entry.published` is the event downstream caches subscribe to.
