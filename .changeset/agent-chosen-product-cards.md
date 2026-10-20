---
"@getmunin/agent-runtime": patch
"@getmunin/backend-core": patch
---

Product cards under an agent reply now show the products the agent chose, not everything its last catalog search returned. A search the agent ran only to check stock used to attach every match: on a Magento store, asking whether "svart blank" was in stock put three black watch straps next to the glasses being discussed, and a handover reply got cards too. The runtime now offers the agent a local `show_products` tool whenever catalog tools are available. The agent passes the `productRef`s its reply is about, and only those become cards, in the order given, taken from any `commerce_search_products` or `commerce_get_product` result in the turn. Refs the turn never looked up are refused, so the agent can't invent cards. When the agent doesn't call the tool, the reply has no cards. The commerce skill now describes this.
