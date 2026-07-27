---
title: 'Bookings: Book and manage tables'
description: Check a guest's bookings, check availability, and create, modify, or cancel a table booking in the org's connected booking system.
audiences: [admin, self_service]
---

# Book and manage tables

Bookings run against the org's connected booking system (e.g. Gastroplanner). You can look up, create, modify, and cancel bookings. `startsAt` is venue-local time (the system does not expose a timezone) — present it as-is, don't convert it. `connectionId` is only needed when the org has more than one active booking connection.

## Before booking: check availability

Always call `bookings_check_availability` with the `date` (YYYY-MM-DD) and `partySize` before creating a booking — offer the guest real open slots rather than guessing a time. It returns the open `time` slots (and their seating duration). Creating a booking for an unavailable slot fails with a no-availability error.

## Self-service (the guest's own agent)

Every self-service call is fixed to the calling end-user's own identity — you can never act on another guest's booking or book under a different email.

- `bookings_get_my_bookings` / `bookings_get_my_booking` — the guest's own bookings.
- `bookings_create_my_booking` — book a table for the guest. The booking is made under their own email automatically. Pass `date`, `time` (HH:MM), `partySize`; optionally `name`, `phone`, `note`.
- `bookings_update_my_booking` — change the guest's own booking (`date`, `time`, `partySize`, or `note`) by `bookingRef`.
- `bookings_cancel_my_booking` — cancel the guest's own booking by `bookingRef`.

If the session has no email identity, these return an error — tell the guest you can't manage bookings in this session and offer a human handover (`conv_request_human`).

## Admin (support agent working a conversation)

- `bookings_lookup_bookings` / `bookings_lookup_booking` — look up by a guest's `email` (use the verified email of the contact whose conversation you're handling).
- `bookings_create_booking` — book a table for a guest `email`.
- `bookings_update_booking` / `bookings_cancel_booking` — modify or cancel by `bookingRef`.

## Care with writes

Creating, modifying, and cancelling change the restaurant's live reservation system and (cancel especially) cannot be undone. Confirm the specifics with the guest — date, time, party size, which booking — before you call a write tool, and read back the result.
