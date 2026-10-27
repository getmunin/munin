---
'@getmunin/backend-core': minor
---

Bookings made through Munin become journey events. When a booking is created, changed or cancelled through the admin booking tools or the guest's self-service tools, and the guest's email is known, Munin records a `booking.created`, `booking.updated` or `booking.cancelled` product event on the guest's contact with the booking reference, start time, party size and venue. The event is recorded in its own transaction after the vendor confirms, so a failure to record it never undoes the booking. Nothing about the booking is stored beyond that event, and bookings made directly in the vendor's system do not arrive.

A `wait` with `untilField` now reads a date-time without an offset, such as a booking's local start time, in the contact's or the journey's timezone instead of UTC. A new built-in template, `booking-reminder` (nb, sv, en), sends a reminder the day before, a thank-you after the visit, and ends the run when the guest cancels.
