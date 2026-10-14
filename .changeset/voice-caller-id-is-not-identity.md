---
"@getmunin/backend-core": patch
---

Stop treating a voice caller's number as proof of who they are.

Caller ID can be forged, and on a call the answer is spoken to whoever placed it, unlike email or SMS, where a reply only reaches the real address or number.

- The Vapi and Threll assistants no longer get the name and email of the CRM contact matching the caller ID. They used to, so someone forging a customer's number was greeted by name and could ask for the email on file. The `[Caller]` block now holds only what the call itself carries: the number and any caller name the vendor sends.
- `crm_get_my_contact` and `crm_update_my_contact` are no longer offered on voice channels, since on a phone call the end user's phone *is* the caller ID.

Order and booking tools are unchanged. Phone callers never had an email identity for them, and calls started from the chat widget keep the widget session's identity.

The Shopify and Gastroplanner adapters gain the same tests as Magento: a vendor that ignores every filter, checked so that no list, order-ref, order-number or booking-ref lookup ever returns another customer's record.
