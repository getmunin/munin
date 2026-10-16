---
'@getmunin/backend-core': patch
---

On an email conversation, a forged or forwarded message can no longer read the customer's orders, bookings or CRM contact.

The self-service booking writes already refused when the latest customer message failed DMARC for its `From` address or was forwarded. Reads were left open on the reasoning that the reply goes to the real owner of the address. That reasoning breaks once the reply can carry data elsewhere: a forged message could ask the agent to put the answer into an image URL, which the recipient's mail client then fetches.

- `commerce_list_my_orders`, `commerce_get_my_order`, `bookings_list_my_bookings` and `bookings_get_my_booking` now refuse with `connectors_sender_auth_failed` / `connectors_sender_forwarded` under the same conditions as the writes.
- `crm_get_my_contact` and `crm_update_my_contact` refuse with `crm_sender_auth_failed` / `crm_sender_forwarded`.
- `ConnectorsService.requireEndUserEmailForWrite` and `optionalEndUserEmailForWrite` are gone, since reads and writes now share one check: use `requireEndUserEmail` and `optionalEndUserEmail`.

Messages with no DMARC result are treated as before.
