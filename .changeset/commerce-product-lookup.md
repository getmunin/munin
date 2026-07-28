---
'@getmunin/backend-core': minor
---

Add live product-catalog lookups to the commerce connector domain: `commerce_search_products` and `commerce_get_product` (admin + self-service) return published products with price range, storefront link, description, and per-variant price and `availableForSale`. Shopify searches are pinned to `status:active` with operator-safe token quoting and need the `read_products` scope; Magento reads enabled+visible products via searchCriteria, expands configurable children, and reports stock from `stockItems` (null when the CatalogInventory ACL is missing). Ships with the `skill://commerce/answer-product-questions` skill and updated connect instructions.
