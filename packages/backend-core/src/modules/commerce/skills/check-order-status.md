---
title: 'Commerce: Check order status'
description: Answer "where is my order?" — list a customer's recent orders, fetch one order's line items and shipment tracking, and know when to hand over to a human.
audiences: [admin, self_service]
---

# Check order status

Order-status questions ("where is my order?", "has it shipped?", "what did I order?") are answered from the org's connected store. All order tools are read-only; nothing here can change, cancel, or refund an order.

## Self-service (customer's own agent)

- `commerce_get_my_orders` — the customer's recent orders, newest first. No email parameter exists: the lookup is fixed to the calling end-user's own identity.
- `commerce_get_my_order` — one order with line items and shipment tracking. Pass `orderRef` from a listing, or `orderNumber` when the customer quotes the number from their confirmation email (leading `#` is fine).

Typical flow for "where is my order?": get the most recent orders, and if one is obviously current, fetch its detail for tracking numbers. If the customer names an order number, go straight to `commerce_get_my_order`.

If the session has no email identity, the tools return an error instead of results — tell the customer you can't access order history in this session and offer a human handover (`conv_request_human`) rather than asking them to type an email; a typed email cannot be used for lookup.

## Admin (support agent working a conversation)

- `commerce_lookup_orders` / `commerce_lookup_order` — same data, but take an `email`. Use the verified email of the contact whose conversation you're handling; don't look up unrelated addresses on a customer's behalf.

## Reading the results

- `status` is vendor-native (Shopify: `open`/`closed`/`cancelled` plus `financialStatus`/`fulfillmentStatus`; Magento: its order status like `processing`, `complete`).
- `shipments[].trackingNumbers` and `trackingUrls` are what the customer usually wants — quote the tracking number and link when present. An order without shipments simply hasn't shipped yet.
- A not-found for an order number the customer insists exists usually means the order was placed under a different email; that's a case for human handover, not repeated lookups.

## When to hand over

Refunds, cancellations, address changes, or disputes can't be done here. Log the request (`crm_log_my_activity` on self-service) and escalate with `conv_request_human` so a human can act in the store's own admin.
