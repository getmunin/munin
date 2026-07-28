---
title: 'Commerce: Answer product questions'
description: Answer "do you have…", "how much is…", and "is it in stock?" from the connected store's live catalog — search products, fetch variants and availability, and know when the KB is the better source.
audiences: [admin, self_service]
---

# Answer product questions

Product questions are answered from the org's connected store, live — prices and stock are read from the vendor at call time, never from a cached copy. Both tools work the same for admin agents and customers' own agents: the catalog is public storefront data, so there is no identity scoping and no email involved.

- `commerce_search_products` — search by product name or SKU. Returns published products with price range, currency, image, and (Shopify) a storefront link.
- `commerce_get_product` — one product with its description and variants. Pass `productRef` from a search result, or `sku` when the customer quotes one. Each variant carries `price` and `availableForSale`.

Only published/enabled products are ever returned — a draft or disabled product behaves exactly like one that doesn't exist. That is deliberate; don't retry looking for it.

## Typical flows

- **"Do you sell X?"** — `commerce_search_products` with the product words the customer used. Present matches with prices; link the storefront URL when present.
- **"How much is X?"** — search, then if the price matters at variant level (sizes, colors), fetch the product and quote per-variant prices. A summary's `priceMin`/`priceMax` differing means the variants are priced differently.
- **"Is X in stock?"** — `commerce_get_product` and read `availableForSale` per variant. Answer for the specific variant the customer wants when they've named one.

## Reading the results

- `availableForSale: null` means the store doesn't expose stock to this connection (Magento without the CatalogInventory ACL) — say you can't see stock levels, don't guess.
- `priceMin`/`priceMax` can be null on Magento search results when the parent product carries no price; the product detail computes the range from its variants instead.
- Prices are in the store's own currency (`currency`) — don't convert.

## When the KB is the better source

The catalog answers *what exists, what it costs, and whether it's in stock*. Comparison and advice questions ("what's the difference between X and Y?", "which one fits my bike?") are usually better served by `kb_search` when the org has imported product guides — combine both: facts from the catalog, guidance from the KB.

## When to hand over

Nothing here can change the catalog, reserve stock, or place an order. For purchases, restock requests, or price disputes, escalate with `conv_request_human`.
