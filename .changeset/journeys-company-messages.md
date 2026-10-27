---
'@getmunin/backend-core': minor
'@getmunin/db': minor
'@getmunin/types': minor
---

Company journeys can send messages. A message step in a journey with `entry.subject: "company"` declares `recipients`, chosen by `tag`, `titleContains` or both, with a `max` (default 3, at most 10). The step files one proposal per chosen person, ordered by who was contacted most recently. Every recipient still goes through their own consent, weekly cap, quiet hours and email thread.

The run waits until every proposal is decided. It continues on `next` if at least one was sent, and ends as dismissed only when all were dismissed. A reply from any recipient follows `onReply`. Email, SMS and chat are supported. Calls, agent drafts and `onUnseen` follow a single person, so they are refused in company journeys, and `recipients` is refused in person journeys.

The unique index on proposals is now per step run and contact (migration 0136). The simulator checks each recipient's send policy.
