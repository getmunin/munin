---
title: 'SEO: Research keywords and competitor gaps'
description: Use the org's own DataForSEO account to size keywords, find new ones, see what any domain ranks for, and list the keywords competitors win that the org does not — while keeping the spend on that account visible and bounded.
audiences: [admin]
---

# Research keywords and competitor gaps

A connected search console tells you about searches the site is *already* shown for. Keyword research answers the questions it can't: how many people search for something the site has never ranked for, what related phrases exist, and which keywords competitors win. The research connector reads that market data live from the org's own DataForSEO account. Nothing is stored in Munin, and nothing is shared across orgs.

**Every call spends the org's money.** DataForSEO bills the connected account per request and per returned row. Treat `limit` as a budget, not a display setting.

## Connecting

DataForSEO authenticates with an API login and API password from its dashboard (app.dataforseo.com → API Access). They are secrets. Never ask for them in chat, and never put them in a tool argument.

1. `connectors_create_connection` with `vendor: "dataforseo"` and a name. Pass no config.
2. The result carries a one-time credential link. Give the operator that link. They paste both values there.
3. `connectors_test_connection` confirms the credentials and reports the account balance.

See `skill://connectors/connect-external-system` for the general flow.

## Tools

All of these take `location` and optional `language`, and `connectionId` only when the org has several research connections.

- **`location`** is a country in Europe or North America, written as its English name in snake_case: `norway`, `germany`, `united_kingdom`, `united_states`, `canada`, `mexico`, `bosnia_and_herzegovina`. The default is `norway`.
- **`language`** defaults to the country's main language. Multilingual countries accept each of theirs: `belgium` (Dutch, French, German), `switzerland` (German, French, Italian), `canada` (English, French), `united_states` (English, Spanish), `ukraine` (Ukrainian, Russian).

Coverage is not the same on every tool:

- **`seo_get_keyword_volume` and `seo_get_serp_snapshot` cover every listed country.** The SERP snapshot also accepts `english` anywhere.
- **The DataForSEO Labs tools cover 47 of the 77 countries.** Those are `seo_list_keyword_ideas`, `seo_list_ranked_keywords` and `seo_list_keyword_gaps`, and each country gets only the languages DataForSEO has indexed there. Examples: Norway in Norwegian only, Finland in Finnish only, Greece in Greek or English.
- **Some countries have no Labs data at all.** They include Iceland, Luxembourg, Georgia, Montenegro, Andorra, Liechtenstein and most of the Caribbean.
- **An unsupported combination is refused up front with `seo_invalid_market`, and nothing is billed.** The message names the languages that *are* offered, so retry with one of them, or fall back to keyword volume plus SERP snapshots for that country.
- **Some countries are missing entirely.** DataForSEO has no location at all for Russia, Belarus, Kosovo, the Faroe Islands, Gibraltar, Puerto Rico or Cuba, so these aren't offered.

- `seo_get_provider_balance` — balance, total deposited and today's spend. Free. Call it before a large request.
- `seo_get_keyword_volume` — monthly volume, CPC and competition for up to 1,000 known keywords, plus 12 months of history. One flat per-request price, however many keywords you pass. That makes it the cheap way to size a list you already have.
- `seo_list_keyword_ideas` — related keywords from up to 20 seeds, with difficulty (0–100) and main intent. Billed per returned row.
- `seo_list_ranked_keywords` — what any public domain ranks for, with position and ranking URL. Billed per returned row.
- `seo_list_keyword_gaps` — keywords up to 3 competitors rank for and the target domain doesn't. One request per competitor, so three competitors cost three times one.
- `seo_get_serp_snapshot` — the current top Google results for one keyword.

## Controlling cost

- **Start small.** Use `limit: 20`–`50` on a first pass. Widen it only when the first page is worth paying for.
- **Pass `maxCostUsd`** whenever the operator has named a budget, or whenever a request is large (many competitors, a high `limit`). The tool estimates the worst case before contacting DataForSEO and refuses when the estimate is higher. A refused call has sent nothing and cost nothing.
- **Report the cost.** Every result has `cost.estimatedUsd` (the worst case, computed before the call) and `cost.actualUsd` (what DataForSEO charged). Tell the operator what a run cost, especially across a multi-step analysis.
- **Don't repeat calls.** Results reflect DataForSEO's current data, and the same question an hour later returns the same answer at the same price.

## Read the numbers correctly

- `volume` is Google's average monthly searches. A `null` means DataForSEO has no figure, not zero searches. Small markets such as Norway, Iceland or the Baltics show many nulls on long-tail phrases.
- `cpc` is in USD, and `competition` is advertiser competition from 0 to 1. Neither measures how hard it is to rank organically. For that use `difficulty` from `seo_list_keyword_ideas`.
- `truncated: true` means more rows existed than `limit` allowed. `noData: true` comes with a `reason` and means DataForSEO answered and had nothing — a real empty answer, not a failure. Errors (bad credentials, balance too low, rate limit) always come back as errors, never as an empty list.

## The gap loop

1. **Check the budget.** `seo_get_provider_balance`.
2. **Find the gap.** `seo_list_keyword_gaps` with the org's domain and 1–3 competitors, `limit: 50`, and a `maxCostUsd`. Keywords where several competitors rank are the strongest signal.
3. **Filter by intent and volume.** Drop navigational keywords (other brands' names). Keep informational and commercial ones with real volume.
4. **Look at who wins.** `seo_get_serp_snapshot` on the top few keywords shows what kind of page ranks: a guide, a comparison, a product page. That tells you what to write.
5. **Find the page that should answer.** `cms_search_entries` and `kb_search` with the keyword. Either nothing exists (write it), or something exists and misses the phrasing (rewrite it).
6. **Fix it** with `cms_update_entry` or `kb_create_document`, using the keyword in the title and opening paragraph.
7. **Measure later with the console.** Once the page is published and crawled, `seo_list_queries` on a Bing or Google Search Console connection shows whether it started earning impressions — see `skill://seo/improve-search-performance`.

## What this cannot do

- It has no history. Each call is a snapshot, and nothing is stored, so rank tracking over time is not available.
- It sees Google only. Bing volumes are not covered.
- Coverage is Europe and North America. A country or language DataForSEO doesn't cover for a given tool is refused up front, before anything is billed.

## Related

- `skill://seo/improve-search-performance` — the search-console half: what the site already ranks for, and index status.
- `skill://connectors/connect-external-system` — creating and credentialing connections.
- `skill://cms/publish-entry` — where the fix in step 6 lands.
