---
'@getmunin/backend-core': patch
'@getmunin/types': minor
---

Journey messages reach the right person on SMS, chat and calls, and events that can't be trusted no longer start journeys.

- **SMS and chat threads follow the recipient.** A journey text or chat message reuses the last thread only when it still goes to the contact's current phone number or signed-in visitor; otherwise it opens a new one.
- **Typed addresses don't count as verified.** A booking an anonymous chat guest makes, and a Shopify order whose customer email Shopify has not verified, is recorded as an event on nobody (`identityVerified: false` on `analytics.product_event.recorded`) instead of being tied to whoever owns that address, so it enters no journey and creates no trusted identity. A signed-in guest whose sign-in vouches for the email, and bookings made by staff, are tied to the contact as before.
- **Shopify replays are duplicates.** Order events are keyed on the signed body rather than the unsigned webhook id, and an order last changed more than three days before it arrives is ignored.
- **Phone quiet hours by default.** SMS and call steps, transactional ones included, wait out `settings.quietHours` or 21:00–08:00 in the person's timezone when the journey sets none (`00:00-00:00` for no window); the validator warns with `phone_quiet_hours` (`DEFAULT_PHONE_QUIET_HOURS`, `journeyQuietHours` in `@getmunin/types`).
- **Agent steps read the thread that was replied on**, so a decide or draft step after an SMS or chat reply sees the reply. `thread` returns the latest ten messages, and `reply` and `thread` have email addresses and phone numbers masked like `events` and `context`.
- **A `stop` decision unsubscribes from marketing.** Besides ending the person's other journeys, it sets `unsubscribedAt`, logs a note on the contact and emits `crm.contact.unsubscribed` (counted by the unsubscribe guardrail).
- **Agent budget.** `settings.agentStepsPerDay` (default 1000) caps agent decisions, drafts and enrichments per journey per UTC day; past it, steps take their fallback and one system alert is raised.
- Decide edges are looked up with `Object.hasOwn`, so `toString` or `constructor` is not an edge. Enrich steps cannot fill keys Munin sets itself (`timezone`, consent fields, `mergedInto`, `outreachOutcome*`), checked on submit as well as in the validator (`isReservedEnrichKey`).
- `/v1/events` refuses `occurredAt` more than five minutes in the future and accepts at most 3000 events a minute per organization (`429` with `retryAfterSeconds` beyond that).
