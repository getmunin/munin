---
title: 'Bookings: Check booking status'
description: Answer "when is my table booked?" — list a guest's bookings, fetch one by confirmation code with time, venue, and party size, and know when to hand over to a human.
audiences: [admin, self_service]
---

# Check booking status

Booking questions ("when is my table?", "how many did I book for?", "is my booking confirmed?") are answered from the org's connected booking system. All booking tools are read-only; nothing here can create, move, or cancel a booking.

## Self-service (guest's own agent)

- `bookings_get_my_bookings` — the guest's bookings, most recent first. No email parameter exists: the lookup is fixed to the calling end-user's own identity.
- `bookings_get_my_booking` — one booking with start time, duration, and party size. Pass `bookingRef` from a listing; `confirmationCode` works only where the venue's system issues codes (Gastroplanner does not — always list first and use the `bookingRef`).

`startsAt` is venue-local time (the booking system does not expose a timezone) — present it as-is, don't convert it.

If the session has no email identity, the tools return an error instead of results — tell the guest you can't access their bookings in this session and offer a human handover (`conv_request_human`) rather than asking them to type an email; a typed email cannot be used for lookup.

## Admin (support agent working a conversation)

- `bookings_lookup_bookings` / `bookings_lookup_booking` — same data, but take an `email`. Use the verified email of the contact whose conversation you're handling; don't look up unrelated addresses on a guest's behalf.

## When to hand over

Changing the time, party size, or cancelling can't be done here — those need the venue's own system. Log the request (`crm_log_my_activity` on self-service) and escalate with `conv_request_human`, including the booking's confirmation code and the requested change so a human can act on it directly.
