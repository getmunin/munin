---
title: Analytics: Identify visitors and link tracking to CRM contacts
description: Link an anonymous analytics visitor to a known end-user / CRM contact so page-views and searches show up on the contact's journey.
audiences: [admin]
---

# Identify visitors

Page-view events from the tracker are anonymous by default — they carry an opaque `visitor_id` (a `localStorage` cookie) and nothing else. Once you know who the visitor is (they signed in, opened an outbound email link, identified themselves in the chat widget), you can link that `visitor_id` to an `end_users` row. From that point on:

- new `analytics_view_events` / `analytics_search_events` rows for the same visitor are stamped with `end_user_id` at ingest
- the chat widget and the CRM share the same `end_users` identity, so a visitor → conversation → CRM contact chain becomes one query
- `analytics_get_contact_journey` returns the chronological page-view + search timeline for a contact — including activity from *before* the link existed, resolved at read time
- `analytics_get_funnel` groups conversion steps by the identified end-user, so a journey that crosses the anonymous → identified boundary counts as one person, not two

This skill walks through wiring it up.

## 1. Mint a tracker with an identity verification secret

`analytics_create_tracker` returns an `identityVerificationSecret` once, alongside the public `trackerKey`. Treat it like an OAuth client secret: store it server-side, never embed it in the browser bundle.

```jsonc
// analytics_create_tracker
{ "name": "example.com landing" }
// → returns:
//   "trackerKey": "mn_track_…",                  // safe to embed
//   "identityVerificationSecret": "…",           // server-only
```

Rotate later with `analytics_rotate_tracker_identity_secret`. The previous secret is replaced immediately — any signed hashes computed against it stop working.

## 2. Sign an identity hash server-side

The hash binds a specific browser (its `visitorId`) to a specific `externalId`, so a leaked or observed hash can only ever link the one visitor it was signed for — it can't be replayed to attach a different visitor to that identity. The browser therefore has to tell your server its `visitorId` before you sign.

Read it in the browser with `window.mn.analytics.getVisitorId()` and send it to your server alongside the logged-in user. Then compute:

```ts
import { createHmac } from 'node:crypto';

function identityPayload(externalId: string, visitorId: string, email?: string): string {
  return ['mn.identity.v1', externalId, visitorId, email ?? '']
    .map((field) => `${Buffer.byteLength(field, 'utf8')}:${field}`)
    .join('');
}

function userHash(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}
```

Each field is length-prefixed so no value can be shifted across a field boundary — which matters because Munin's own provisional ids contain a colon (`email:kari@example.no`).

`externalId` is whatever stable id you use for the user in your own system (database row id, auth provider sub, etc.). The same value will be stored on the resulting `end_users` row. `visitorId` is the value returned by `window.mn.analytics.getVisitorId()`.

`email` is optional, and it is what joins web analytics to the email inbox — see step 4. Sign the exact string you send: the email is inside the HMAC precisely so that a browser can't claim someone else's address and pull down their journey. An unsigned or mis-signed email is rejected outright, and the whole `identify` call is dropped with it.

Integrations written before the email field exist keep working: when no `email` is sent, the older `${externalId}:${visitorId}` payload is still accepted.

## 3. Call `window.mn.analytics.identify` from the browser

The tracker loads async, so `window.mn.analytics` is `undefined` until the script has executed. Once initialized the tracker installs the namespace with `ready = true` and dispatches a `munin:analytics-ready` CustomEvent on `document` — gate on those instead of polling:

```js
const go = () => {
  const visitorId = window.mn.analytics.getVisitorId();
  // send { externalId, visitorId, email } to your server, get back userHash, then:
  window.mn.analytics.identify(externalId, userHash, { email });
};

window.mn?.analytics?.ready
  ? go()
  : document.addEventListener('munin:analytics-ready', go, { once: true });
```

The `ready` flag is what closes the listener-attached-too-late race: if the tracker finished initializing before your code ran, the event has already fired and gone, but the flag tells you it is safe to run immediately.

Call it once, after sign-in, on every authenticated page. The tracker sends `(visitorId, externalId, userHash, email?)` to `POST /v1/a/identify`. The backend:

1. Validates the HMAC against the tracker's identity verification secret. Mismatches and missing secrets are silently dropped.
2. Resolves the `end_users` row (see step 4).
3. Upserts the `(orgId, visitorId) → endUserId` row in `analytics_visitor_identities`.

Every subsequent tracker beacon for the same `visitorId` lands with `end_user_id` populated.

Because the hash covers the `visitorId`, you must sign per browser session — you can't precompute a hash server-side without first learning the visitor's id, so the old `data-user-hash` script-tag auto-identify is not supported. Do the one-time round trip (read `getVisitorId()` → sign → `identify()`) on the first authenticated page load.

## 4. How the signed email joins web analytics to the inbox

Without an email, `identify` only ever matches on `externalId`, and a person who emailed support before they ever logged in ends up as two `end_users` rows that never meet — one keyed by your customer id, one keyed by the address they wrote from.

Passing the signed `email` closes that gap in both directions:

| Order of events | What happens |
|---|---|
| They emailed first, then signed in | The inbound mail created a **provisional** identity keyed `email:<address>`. `identify` finds it by address and promotes it in place — `external_id` becomes your customer id, the row id never changes, so every conversation, CRM contact and analytics event already attached to it stays attached. |
| They signed in first, then emailed | `identify` created the identity with your customer id and stamped the address on it. The inbound mail resolves by address and reuses that same row instead of forking a provisional one. |
| Both identities already exist with real ids | Nothing is merged. The address stays with whoever holds it, the caller's identity is kept separate, and the server logs `identify.email_conflict`. Merging two established people is a decision for an operator, not a side effect of a page load. |

One address belongs to one identity per org — enforced by a unique index — so a shared mailbox (`post@firma.no`) resolves to a single `end_users` row no matter how many humans write from it. That is usually what you want for a support inbox, and it is worth knowing before you treat a journey as one person's browsing history.

## 5. Read the journey

```jsonc
// analytics_get_contact_journey
{ "contactId": "ctc_…", "sinceDays": 30, "limit": 100 }
```

Returns the visitor's page-view and search timeline, chronologically. Or pass `endUserId` directly if you already have it (e.g. resolved through the widget). Events recorded *before* the visitor was linked are included too: the journey resolves the `visitor_id → end_user` link at read time, so a contact's anonymous history — the pages they read before they ever identified — shows up retroactively the moment the link exists. (The link only reaches forward across one `visitor_id`; activity on a different device/browser, with its own `visitor_id`, joins only once that visitor identifies too.)

You can also pass `endUserId` / `contactId` to `analytics_get_views_over_time`, `analytics_get_subject_engagement`, and `analytics_list_top_subjects` to scope those aggregates to one identified visitor.

### Aggregates see the pre-identify events too

Those aggregates filter on the `end_user_id` **column**, not the read-time bridge join — so they only see rows that carry the id. Linking a visitor therefore also stamps their recent anonymous rows: `identify` (and the widget's own identity resolution) backfills `end_user_id` on that visitor's `analytics_view_events` and `analytics_search_events` rows from the last **30 days**, in the same transaction as the link. This is what makes the landing page of a session attributable — the auto page view always reaches the server before your `identify` round-trip finishes, so without the backfill the first event of every new visitor would stay anonymous forever.

Rows older than 30 days keep `end_user_id = NULL`. `analytics_get_contact_journey` still finds them (it resolves the bridge at read time); the column-based aggregates do not.

## How widget chats fit in

The chat widget does its own identity resolution (via `verifiedExternalId` + `userHash` on the widget channel's secret — a *different* secret from the tracker's; see `skill://conv/setup-chat-widget`). Note the widget hash covers `externalId` **only**, not the visitor, so it can be server-rendered without a round-trip — the opposite of the tracker's visitor-bound hash above. When the widget creates or resolves an `end_users` row, it also writes the bridge row using its own `visitorId`. Because the widget and the analytics tracker share the same `localStorage` key (`mn.vid`) for their visitor id, a visitor who first opened the chat widget already has their analytics history linked — no additional `identify` call needed for that path.

### Each surface identifies through its own namespace

The two bundles share the `window.mn` object but own separate namespaces, so a page running both calls each one explicitly:

```js
window.mn.analytics.identify(externalId, trackerHash, { email });  // visitor-bound hash
window.mn.widget.identify(externalId, widgetHash);                 // externalId-only hash
```

Two calls, because these are genuinely two credentials: the tracker verifies the visitor-bound `mn.identity.v1` payload against the tracker's secret, the widget verifies `externalId` against the widget channel's secret. A hash minted for one will never verify for the other, so don't pass the same value to both.

On a server-rendered page you can skip the widget call entirely by putting `data-external-id` + `data-user-hash` on the embed instead.

**Migrating from 4.x:** `window.mn.identify(...)` was the tracker's and is now `window.mn.analytics.identify(...)`; `window.mn.ready` is now `window.mn.analytics.ready`, and the `munin:ready` event is now `munin:analytics-ready`. Before the split both bundles installed `identify` on the shared root and chained to each other, so one of them always rejected the hash it was handed — silently, on the tracker's side.
