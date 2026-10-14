---
"@getmunin/backend-core": patch
---

Close two paths that let one chat customer read another customer's data.

- **Delegated tokens no longer launder a visitor-typed email.** A signed-in widget visitor could type someone else's address, which was stored as self-reported. When the org's backend later minted a delegated token for the real owner by email alone, the mint adopted the visitor's end user and stamped the email as org-attested, so that visitor's chat could then list the owner's store orders and bookings. A mint by email now skips any end user whose email was self-reported (anonymous, or typed by a visitor), releases that unverified claim, and binds the email to a fresh end user. Minting for a named end user replaces a self-reported email instead of refusing with `delegated_email_mismatch`.
- **`crm_get_my_contact` and `crm_update_my_contact` only return a contact the session has proven** and otherwise refuse with `crm_unverified`. Contact extraction matches existing contacts by email or phone, so a contact created from an address or number a visitor typed could later be backfilled with the real owner's name and phone from their own conversation, and the visitor's agent could read them back. The contact is returned only when the session's identity is not self-reported and the contact's email matches the end user's email, or, for a contact without an email, its phone matches the end user's phone.
- **Magento order-number lookups filter by customer email at the store.** Order numbers repeat across store views, so a lookup without a store code could fetch another customer's order first; the ownership check already discarded it, but the customer's own order then came back as not found.
