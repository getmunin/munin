---
title: Analytics: Identify visitors and link tracking to CRM contacts
description: Link an anonymous analytics visitor to a known end-user / CRM contact so page-views and searches show up on the contact's journey.
audiences: [admin]
---

# Identify visitors

Page-view events from the tracker are anonymous by default — they carry an opaque `visitor_id` (a `localStorage` cookie) and nothing else. Once you know who the visitor is (they signed in, opened an outbound email link, identified themselves in the chat widget), you can link that `visitor_id` to an `end_users` row. From that point on:

- new `analytics_view_events` / `analytics_search_events` rows for the same visitor are stamped with `end_user_id` at ingest
- the chat widget and the CRM share the same `end_users` identity, so a visitor → conversation → CRM contact chain becomes one query
- `analytics_get_contact_journey` returns the chronological page-view + search timeline for a contact

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

When your application server knows the user is logged in, compute:

```ts
import { createHmac } from 'node:crypto';

function userHash(externalId: string, secret: string): string {
  return createHmac('sha256', secret).update(externalId).digest('hex');
}
```

`externalId` is whatever stable id you use for the user in your own system (database row id, auth provider sub, etc.). The same value will be stored on the resulting `end_users` row.

Render the hash and id into the page (a `<script>` block, a `data-` attribute, a hydration payload — whatever your stack uses).

## 3. Call `window.mn.identify` from the browser

The tracker script exposes:

```ts
window.mn.identify(externalId, userHash);
```

Call it once, after sign-in, on every authenticated page. The tracker sends `(visitorId, externalId, userHash)` to `POST /v1/a/identify`. The backend:

1. Validates the HMAC against the tracker's identity verification secret. Mismatches and missing secrets are silently dropped.
2. Upserts an `end_users` row keyed by `(orgId, externalId)`.
3. Upserts the `(orgId, visitorId) → endUserId` row in `analytics_visitor_identities`.

Every subsequent tracker beacon for the same `visitorId` lands with `end_user_id` populated.

## 4. Read the journey

```jsonc
// analytics_get_contact_journey
{ "contactId": "ctc_…", "sinceDays": 30, "limit": 100 }
```

Returns the visitor's page-view and search timeline, chronologically. Or pass `endUserId` directly if you already have it (e.g. resolved through the widget). Events recorded before the visitor was linked stay anonymous and are not returned — there's no retroactive backfill.

You can also pass `endUserId` / `contactId` to `analytics_get_views_over_time`, `analytics_get_subject_engagement`, and `analytics_list_top_subjects` to scope those aggregates to one identified visitor.

## How widget chats fit in

The chat widget does its own identity resolution (via `verifiedExternalId` + `userHash` on the widget channel's secret). When the widget creates or resolves an `end_users` row, it also writes the bridge row using its own `visitorId`. Because the widget and the analytics tracker share the same `localStorage` key (`mn.vid`) for their visitor id, a visitor who first opened the chat widget already has their analytics history linked — no additional `identify` call needed for that path.
