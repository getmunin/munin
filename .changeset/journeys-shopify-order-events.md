---
'@getmunin/backend-core': minor
---

Shopify order events: a Shopify connection can store a webhook signing secret, and `POST /v1/commerce/shopify/webhooks/:connectionId` turns signed `orders/create`, `orders/paid`, `orders/fulfilled` and `orders/cancelled` webhooks into `order.created`, `order.paid`, `order.fulfilled` and `order.cancelled` product events on the customer's contact, deduplicated by Shopify's webhook id. Only the order number, total, currency, status and line-item count are kept — no addresses, names or line items. `commerce_get_order_event_setup` returns the webhook URL and topics per connection, and the `skill://commerce/connect-order-events` skill walks through the setup. Journeys and segments use the events like any other product event.
