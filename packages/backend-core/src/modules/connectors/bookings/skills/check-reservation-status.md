---
title: 'Bookings: Check reservation status'
description: Answer "when is my table booked?" — list a guest's reservations, fetch one by confirmation code with time, venue, and party size, and know when to hand over to a human.
audiences: [admin, self_service]
---

# Check reservation status

Reservation questions ("when is my table?", "how many did I book for?", "is my booking confirmed?") are answered from the org's connected booking system. All reservation tools are read-only; nothing here can create, move, or cancel a booking.

## Self-service (guest's own agent)

- `bookings_get_my_reservations` — the guest's reservations, most recent first. No email parameter exists: the lookup is fixed to the calling end-user's own identity.
- `bookings_get_my_reservation` — one reservation with venue, start time, duration, party size, and note. Pass `reservationRef` from a listing, or `confirmationCode` when the guest quotes the code from their booking confirmation.

`startsAt` is venue-local time (the booking system does not expose a timezone) — present it as-is, don't convert it.

If the session has no email identity, the tools return an error instead of results — tell the guest you can't access their bookings in this session and offer a human handover (`conv_request_human`) rather than asking them to type an email; a typed email cannot be used for lookup.

## Admin (support agent working a conversation)

- `bookings_lookup_reservations` / `bookings_lookup_reservation` — same data, but take an `email`. Use the verified email of the contact whose conversation you're handling; don't look up unrelated addresses on a guest's behalf.

## When to hand over

Changing the time, party size, or cancelling can't be done here — those need the venue's own system. Log the request (`crm_log_my_activity` on self-service) and escalate with `conv_request_human`, including the reservation's confirmation code and the requested change so a human can act on it directly.
