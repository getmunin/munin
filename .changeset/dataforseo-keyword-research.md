---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

Add DataForSEO as a bring-your-own-key keyword-research connector in the `seo` domain. Six new read-only tools — `seo_get_provider_balance`, `seo_get_keyword_volume`, `seo_list_keyword_ideas`, `seo_list_ranked_keywords`, `seo_list_keyword_gaps` and `seo_get_serp_snapshot` — cover Norway, Sweden, Denmark and the UK. Each org connects its own DataForSEO account: the API login and password are collected only through the one-time credential link, stored encrypted, and never appear in tool input or output. `connectors_test_connection` reports the account balance.

Every research call estimates its worst-case cost from DataForSEO's published per-task and per-item prices before sending anything. It refuses up front when an optional `maxCostUsd` would be exceeded, and every result reports both `cost.estimatedUsd` and `cost.actualUsd`. DataForSEO's per-task status codes are checked on every response, so an insufficient balance, rejected credentials, rate limiting or an unsupported market comes back as a clear error rather than an empty result. A genuinely empty answer is flagged with `noData` and a `reason`.

`seo` now holds two adapter contracts, `SeoConsoleAdapter` (Bing, Google Search Console) and `SeoResearchAdapter` (DataForSEO). `ConnectorsService.resolveScope` takes an optional capability filter, so an org with a search-console connection and a research connection can still call either tool family without passing `connectionId`. The Integrations page gets a DataForSEO card, and a new `skill://seo/research-keywords` describes the workflow and how to keep spend bounded.
