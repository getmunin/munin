---
title: Connect Shopify order events
description: Send a Shopify store's order webhooks into Munin as product events (order.created, order.paid, order.fulfilled, order.cancelled), so journeys can start or branch on purchases and segments can filter on them. Munin stores the event, not the order.
audiences: [admin]
---

# Connect Shopify order events

Shopify can tell Munin when an order is created, paid, fulfilled or cancelled. Each signed webhook becomes a product event on the customer's contact — `order.paid` and so on — with only the order number, total, currency and status. Nothing else about the order is kept; for line items or tracking, look the order up live with `commerce_lookup_order`.

## 1. Find the connection

`connectors_list_connections` with domain `commerce` lists the Shopify connections. If there is none, set one up first (shop domain and Admin API token).

## 2. Get the webhook URL

`commerce_get_order_event_setup` returns, per Shopify connection, the webhook URL and the topics Munin listens to. Give the operator these steps in Shopify admin:

1. Settings → Notifications → Webhooks → Create webhook.
2. Event: one of `Order creation`, `Order payment`, `Order fulfillment` or `Order cancellation`; format JSON; URL from the setup result. Repeat for each event they want.
3. Copy the signing secret Shopify shows under the webhook list ("Your webhooks will be signed with …").

## 3. Store the signing secret

The secret goes into the connection's `webhookSecret` field through the credential link from `connectors_request_credentials` — never paste it into chat. Until it is stored, `signingSecretSet` is false and Munin refuses the webhooks, because it cannot check that they came from Shopify.

## 4. Check it works

Ask the operator to place or mark a test order, then `analytics_list_product_event_names` should show `order.paid` (or the topic they chose). Orders without a customer email are skipped, since there is no one to attach them to.

## Using the events

- Journey entry on `order.paid` (for example a post-purchase follow-up), `wait_for` on `order.paid` after a quote or trial, or a goal of `order.paid`.
- Segment filters on events, such as "no `order.paid` in the last 90 days" for win-back.
