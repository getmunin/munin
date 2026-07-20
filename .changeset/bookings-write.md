---
'@getmunin/backend-core': minor
---

Bookings write support: the Gastroplanner adapter can now check availability and create, modify, and cancel bookings via the booking API. New admin tools `bookings_check_availability`, `bookings_create_booking`, `bookings_update_booking`, `bookings_cancel_booking` and self-service tools `bookings_create_my_booking`, `bookings_update_my_booking`, `bookings_cancel_my_booking` (self-service writes bind to the calling end-user's own email and enforce ownership before modifying or cancelling). Adds the `bookings:write` scope and renames the skill to `skill://bookings/manage-bookings`.
