---
'@getmunin/backend-core': minor
---

Bookings module: connector-backed booking lookups with a Gastroplanner adapter. Admin tools (`bookings_lookup_bookings`, `bookings_lookup_booking`) take a guest email; self-service tools (`bookings_get_my_bookings`, `bookings_get_my_booking`) bind to the calling end-user's email server-side. Adds the `bookings:read` scope and `skill://bookings/check-booking-status`.
