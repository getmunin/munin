---
'@getmunin/backend-core': patch
'@getmunin/chat-widget': patch
---

Product cards in the chat widget now link to the product page for Magento stores, and the whole card is clickable.

The Magento adapter always returned `url: null` for products, so the widget never rendered a link and the cards gave no sign they could be opened. Products now link to Magento's own product route on the store view's base URL by default. A new optional `productUrlTemplate` connection field (`{urlKey}`, `{sku}`, `{id}`) covers storefronts served from a different host than the Magento API, such as headless frontends, and lets a standard store use its pretty URLs. Products that are not visible individually get no link.

In the widget the whole product card is now the link, with a hover border and a focus ring, instead of only the small "View" pill.
