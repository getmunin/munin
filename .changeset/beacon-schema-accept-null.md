---
'@getmunin/backend-core': patch
---

Fix tracker beacons being silently dropped when the payload contains JSON `null` for optional fields.

The `BeaconBodySchema` in `analytics-tracker.controller.ts` declared every optional field as `z.string().optional()` (or the numeric equivalent), which Zod treats as `string | undefined` — JSON `null` fails validation. The controller then `return`s on `safeParse → !success` without logging, so the event is silently dropped.

The deployed `@getmunin/analytics-tracker` bundle sends `null` (not `undefined`) for at least:
- `referrer` — on direct navigation (`document.referrer === ''` → bundle normalizes to `null`)
- `visitorId` — when `localStorage` throws or returns `null` (private windows, embedded WebViews, locked-down enterprise browsers)

So real traffic from refreshes, bookmarks, direct URL bar entries, and a chunk of mobile/private-mode visits has been disappearing since the schema was tightened in #362.

Fix: make every optional field `.nullable().optional()`. The downstream `recordView` already accepts `null | undefined` interchangeably (uses `??`), so no service-side changes needed. Integration test now sends an all-null payload and asserts the row lands.
