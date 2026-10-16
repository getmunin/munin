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

Every self-service call is tied to the session you're answering in. You can never read another guest's bookings, or change or cancel a booking this session has no claim to.

- `bookings_list_my_bookings` / `bookings_get_my_booking`: the guest's own bookings. These need a verified email; without one they return an error.
- `bookings_create_my_booking`: book a table. Pass `date`, `time` (HH:MM), `partySize`; optionally `name`, `phone`, `note`.
- `bookings_update_my_booking`: change a booking (`date`, `time`, `partySize`, or `note`) by `bookingRef`.
- `bookings_cancel_my_booking`: cancel a booking by `bookingRef`.

### Sessions with a verified email

A signed-in chat, or an email from the guest's own address. Bookings are made under that email automatically, and passing a different `email` is refused. Update and cancel work on any of the guest's bookings.

### Sessions without one

An anonymous chat or a phone call. You can still take a booking:

- **Ask for the guest's email and pass it as `email`.** The booking is filed under it and the confirmation goes there. Nothing about that address is looked up or shown to you; you only get back the booking you just made. On a call, `phone` defaults to the caller's number, so only ask for it if they want a different one.
- **Up to 3 bookings per conversation.** The fourth returns `bookings_limit`.
- **Changes are limited to bookings made in this conversation.** Update and cancel work only on those, so "make it 8 instead" right after booking is fine. They can't look up or change any earlier booking. That needs a verified session or a human handover (`conv_request_human`).

### Lookups and changes are refused when the message looks forged

For a session that carries the guest's email, creating, changing or cancelling a booking works on the same sessions that can read, with one exception that applies to reads as well: when you're answering an **email** and a message in the guest's latest turn explicitly failed its DMARC check for the address it claims to come from, the booking tools return `connectors_sender_auth_failed`. That result means the receiving mail server saw the `From:` domain's own policy reject the sender, which is how a forged `From:` header shows up. It can also be a misconfigured mail relay, so don't accuse the guest of anything.

The booking tools also return `connectors_sender_forwarded` when a message in the guest's latest turn was forwarded — someone sent it on to the support address with the guest's address inside the forwarded text. Munin takes the guest's address from that text, and no mail server has checked it, so it can't be used to look up or change a booking. Forwarding is ordinary (a colleague passing a request along), so treat it like the DMARC case: no accusation.

When you hit `connectors_sender_auth_failed` or `connectors_sender_forwarded`, don't retry and don't work around it by calling an admin tool. Tell the guest you can't look up or change the booking from this message and offer a human handover (`conv_request_human`).

## Admin (support agent working a conversation)

- `bookings_list_guest_bookings` / `bookings_lookup_booking` — look up by a guest's `email` (use the verified email of the contact whose conversation you're handling).
- `bookings_create_booking` — book a table for a guest `email`.
- `bookings_update_booking` / `bookings_cancel_booking` — modify or cancel by `bookingRef`.

## Care with writes

Creating, modifying, and cancelling change the restaurant's live reservation system and (cancel especially) cannot be undone. Confirm the specifics with the guest — date, time, party size, which booking — before you call a write tool, and read back the result.
