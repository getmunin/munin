---
"@getmunin/backend-core": patch
"@getmunin/db": patch
---

Take a table booking from a guest whose email isn't verified, such as an anonymous chat visitor or a phone caller.

`bookings_create_my_booking` used to refuse any session without a verified email, so phone callers and anonymous widget visitors could never book. Creating a booking reveals nothing about anyone, so such a session may now book under an email the guest gives in `email`. On a call, the phone defaults to the caller's number.

- **Limited reach.** The tool returns only the booking it just made, never another booking filed under that address.
- **Up to 3 such bookings per conversation**, refused with `bookings_limit` after that.
- **Same-conversation changes only.** `bookings_update_my_booking` and `bookings_cancel_my_booking` work on those bookings within the same conversation, after confirming with the vendor that each booking is still filed under the email it was made with. Every other booking still needs a verified email, so a guest session cannot look up, change or cancel anything it didn't make.
- **Verified sessions are unchanged**, except that passing a different `email` is now refused instead of ignored.
- **Forgery checks still apply.** A session whose email fails the DMARC or forwarded-sender check is still refused, rather than treated as a guest.

Bookings made this way are recorded in a new `bookings_guest_bookings` table (migration `0115_bookings_guest_bookings`). Its RLS policy lets an end user see only rows on their own conversations.
