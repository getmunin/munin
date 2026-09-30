---
'@getmunin/backend-core': patch
---

Self-service booking writes now refuse email whose sender identity was taken from a forward rather than from the authenticated message.

When a relay email channel receives a forwarded message, Munin attributes the conversation to the original sender named inside the forwarded text. No mail server ever checked that address, so a message in the latest customer turn that was forwarded now records `senderAuth: 'forwarded'`, and `bookings_create_my_booking`, `bookings_update_my_booking` and `bookings_cancel_my_booking` refuse with `connectors_sender_forwarded` in that case. Reads are unchanged.

Forward detection also no longer masks a DMARC failure. The DMARC verdict of the message as received is evaluated first, and a `fail` stays `fail` even when the message looks like an automatic or manual forward. An automatic forward whose sender is the message's own `From` address now carries that message's real verdict instead of always recording `unknown`.
