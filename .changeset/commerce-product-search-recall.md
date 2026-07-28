---
'@getmunin/backend-core': patch
---

Commerce: stop telling customers a stocked product doesn't exist.

`commerce_search_products` claimed "we don't have that" for products the store demonstrably sells. Three separate causes, all in the adapters.

- **No relevance ordering at all.** The Shopify products query never set `sortKey`, so it defaulted to `ID` — creation order. With a `limit` of 10 against a store with many matches, the agent was shown ten arbitrary products and could never see the best one. Now `sortKey: RELEVANCE`.
- **Every term was required.** Shopify implies `AND` between terms, so `borrelåsreim jenter` demanded both words and matched nothing, because no product title contains "jenter". Magento was stricter still: it wrapped the *whole* query in a single `LIKE '%…%'`, so word order mattered — `borrelåsreim Xplora` could not match "Xplora 4 Borrelåsreim Blå". Magento now filters one group per term (all terms must appear, in any order), and both adapters retry a multi-term search as OR when the all-terms pass finds nothing. Precise queries keep their precision; the second vendor call only happens on a miss.
- **OR results came back badly ordered, and re-ranking them starved.** Shopify's own `RELEVANCE` does not favour products matching more of the OR terms — for `borrelåsreim Xplora jenter` it ranked Samsung straps and screen protectors above the nine Xplora straps that matched two terms, placing them beyond position 25. So the broad pass now over-fetches a flat pool of 50 and re-ranks locally by how many query terms appear in the title, stable within equal coverage, before truncating to the caller's limit. The pool is deliberately not a multiple of `limit` — the depth needed is set by how badly the vendor orders OR results, not by how many results we intend to show, and a proportional pool left `limit: 3` and `limit: 5` still showing the wrong products first.

Shopify's search-syntax `OR` binds tighter than `AND`, so the fallback query is explicitly parenthesised as `status:active AND (…)`. Terms stay double-quoted, which also keeps a literal `OR` typed by a customer as a search term rather than a connective.

Not attempted: prefix wildcards (`term*`) would need a second, unquoted escaping path, since wildcards inside a quoted phrase are literal — that reintroduces search-syntax injection surface for a partial-word win. Typo tolerance is not available on either Admin API at all; on Shopify it would mean moving to the Storefront API's `predictiveSearch`, which needs a separate storefront access token on every existing connection and caps results at 10. Both deferred.
