---
title: 'SEO: Improve search performance'
description: Close the loop between what people search for before they arrive and what they do after — read impressions and position from the connected search engine, find the page that should have answered, fix it, and submit it for recrawl.
audiences: [admin]
---

# Improve search performance

Munin's analytics answer the post-click half of a traffic question: which pages got viewed, where visitors came from, what they searched for on the site and found nothing. A connected search engine answers the pre-click half: what people typed, how often the site was shown, and where it ranked. Neither half is actionable alone. Together they point at a specific page and a specific gap, and the same agent can then fix it.

The connector is read-live: nothing from the search engine is stored in Munin, so every call reflects what the engine holds right now.

## Tools

- `seo_list_properties` — the verified sites this connection can report on. Call it first if you don't know the `siteUrl`.
- `seo_list_queries` — queries by impressions, with clicks, `ctr` and `avgPosition`.
- `seo_list_pages` — the same measures per page URL.
- `seo_inspect_url` — one URL's index record: indexed or not, HTTP status at last crawl, when it was last crawled and first discovered.
- `seo_submit_urls` — ask the engine to (re)crawl up to 500 URLs under the property.

`connectionId` is only needed when the org has several active seo connections. `siteUrl` is only needed when the account has several verified properties — with one, it resolves itself.

## Read the numbers correctly

Three properties of this data will mislead you if you treat it like Munin's own analytics:

- **It lags.** Reporting is 2–3 days behind. A page published yesterday has no data yet, and that is not a problem to diagnose.
- **Bing reports in whole weeks.** Each row covers the seven days ending on a Friday. So the `window` in the result is the range actually covered and is usually narrower than the `from`/`to` you asked for. Quote `window`, never the range you requested. When it is `null`, no data fell in range at all.
- **`avgPosition` is impression-weighted and can be null.** Null means the engine reported no position for that row, not position zero. A query with 4 impressions and position 3 is noise; sort your attention by impressions.

## The loop

1. **Find the gap.** `seo_list_queries` over a wide window. The interesting rows are high `impressions` with low `clicks` — the engine is showing the site for that query and nobody is choosing it. Very high `avgPosition` (a large number) with real impressions is the other shape: the query matters but the site ranks far down.
2. **Confirm it from the other side.** `analytics_list_zero_result_searches` shows what visitors searched for *on* the site and got nothing — a query appearing in both lists is a content gap confirmed twice. `analytics_list_referrer_hosts` and `analytics_list_traffic_sources` tell you whether search traffic is actually arriving.
3. **Find the page that should answer.** `kb_search` and `cms_search_entries` with the query wording. Three outcomes worth distinguishing: nothing exists (write it), something exists but doesn't use the customer's words (rewrite it), or the right page exists and ranks badly for reasons content can't fix (report that, don't churn the page).
4. **Check the page is even indexed** before rewriting it — `seo_inspect_url`. A page the engine has never crawled, or last crawled with a non-200 status, has an infrastructure problem; editing the copy will not move it.
5. **Fix it.** `cms_update_entry` for marketing pages, `kb_create_document` or `kb_update_document` for support content. Use the customer's phrasing from step 1 in the title and opening paragraph.
6. **Submit it.** `seo_submit_urls` with the URLs you changed. Submissions spend a per-site daily quota, so submit what changed and nothing else — never the whole sitemap "to be safe". The result reports the quota left; if the call is rejected for exceeding it, the batch was not submitted at all and there is nothing to undo.
7. **Come back later, not now.** Effects need a recrawl plus the reporting lag. Re-checking the same query an hour later tells you nothing.

## What this cannot do

- It cannot see queries with very few impressions — search engines withhold low-volume and personally identifying queries. An absent query is not proof of zero impressions.
- It cannot attribute revenue. Clicks here and conversions in `analytics_get_funnel` are separate datasets over different identity models; describe them side by side rather than dividing one by the other.
- Submitting a URL is a request, not a guarantee: the engine decides whether and when to crawl, and indexing is never promised. Report what was submitted, not what will rank.
