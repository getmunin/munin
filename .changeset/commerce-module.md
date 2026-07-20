---
'@getmunin/backend-core': minor
---

Commerce module: connector-backed order lookups with Shopify and Magento 2 adapters. Admin tools (`commerce_lookup_orders`, `commerce_lookup_order`) take a customer email; self-service tools (`commerce_get_my_orders`, `commerce_get_my_order`) bind to the calling end-user's email server-side. Adds the `commerce:read` scope and `skill://commerce/check-order-status`.
