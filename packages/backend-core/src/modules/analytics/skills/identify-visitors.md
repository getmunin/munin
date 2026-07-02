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
{ "name": "getmunin.com landing" }
// → returns:
//   "trackerKey": "mn_track_…",                  // safe to embed
//   "identityVerificationSecret": "…",           // server-only
```

Rotate later with `analytics_rotate_tracker_identity_secret`. The previous secret is replaced immediately — any signed hashes computed against it stop working.

## 2. Sign an identity hash server-side

The hash binds a specific browser (its `visitorId`) to a specific `externalId`, so a leaked or observed hash can only ever link the one visitor it was signed for — it can't be replayed to attach a different visitor to that identity. The browser therefore has to tell your server its `visitorId` before you sign.

Read it in the browser with `window.mn.getVisitorId()` and send it to your server alongside the logged-in user. Then compute:

```ts
import { createHmac } from 'node:crypto';

function userHash(externalId: string, visitorId: string, secret: string): string {
  return createHmac('sha256', secret).update(`${externalId}:${visitorId}`).digest('hex');
}
```

`externalId` is whatever stable id you use for the user in your own system (database row id, auth provider sub, etc.). The same value will be stored on the resulting `end_users` row. `visitorId` is the value returned by `window.mn.getVisitorId()`.

## 3. Call `window.mn.identify` from the browser

The tracker loads async, so `window.mn` is `undefined` until the script has executed. Once initialized the tracker sets `window.mn.ready = true` and dispatches a `munin:ready` CustomEvent on `document` — gate on those instead of polling:

```js
const go = () => {
  const visitorId = window.mn.getVisitorId();
  // send { externalId, visitorId } to your server, get back userHash, then:
  window.mn.identify(externalId, userHash);
};

window.mn?.ready
  ? go()
  : document.addEventListener('munin:ready', go, { once: true });
```

The `ready` flag is what closes the listener-attached-too-late race: if the tracker finished initializing before your code ran, the event has already fired and gone, but the flag tells you it is safe to run immediately.

Call it once, after sign-in, on every authenticated page. The tracker sends `(visitorId, externalId, userHash)` to `POST /v1/a/identify`. The backend:

1. Validates the HMAC of `${externalId}:${visitorId}` against the tracker's identity verification secret. Mismatches and missing secrets are silently dropped.
2. Upserts an `end_users` row keyed by `(orgId, externalId)`.
3. Upserts the `(orgId, visitorId) → endUserId` row in `analytics_visitor_identities`.

Every subsequent tracker beacon for the same `visitorId` lands with `end_user_id` populated.

Because the hash covers the `visitorId`, you must sign per browser session — you can't precompute a hash server-side without first learning the visitor's id, so the old `data-user-hash` script-tag auto-identify is not supported. Do the one-time round trip (read `getVisitorId()` → sign → `identify()`) on the first authenticated page load.

## 4. Read the journey

```jsonc
// analytics_get_contact_journey
{ "contactId": "ctc_…", "sinceDays": 30, "limit": 100 }
```

Returns the visitor's page-view and search timeline, chronologically. Or pass `endUserId` directly if you already have it (e.g. resolved through the widget). Events recorded *before* the visitor was linked are included too: the journey resolves the `visitor_id → end_user` link at read time, so a contact's anonymous history — the pages they read before they ever identified — shows up retroactively the moment the link exists. (The link only reaches forward across one `visitor_id`; activity on a different device/browser, with its own `visitor_id`, joins only once that visitor identifies too.)

You can also pass `endUserId` / `contactId` to `analytics_get_views_over_time`, `analytics_get_subject_engagement`, and `analytics_list_top_subjects` to scope those aggregates to one identified visitor.

## How widget chats fit in

The chat widget does its own identity resolution (via `verifiedExternalId` + `userHash` on the widget channel's secret). When the widget creates or resolves an `end_users` row, it also writes the bridge row using its own `visitorId`. Because the widget and the analytics tracker share the same `localStorage` key (`mn.vid`) for their visitor id, a visitor who first opened the chat widget already has their analytics history linked — no additional `identify` call needed for that path.
