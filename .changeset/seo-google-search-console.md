---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
'@getmunin/db': patch
---

Add Google Search Console to the `seo` domain, behind the same `seo_*` tools.

This is the payoff for drawing `SeoAdapter` before there was a second vendor: `GoogleSearchConsoleAdapter` implements the same contract, registers into the same domain, and every `seo_*` tool works against it with **no tool-layer change at all**. It authorizes through the connector trunk's OAuth capability, so there is no Google-specific auth code either — an org supplies its own OAuth client id and secret, then approves the Google account by redirect.

**Where the two engines genuinely differ, the interface admits it rather than faking it.**

`submitUrls` is optional on `SeoAdapter`, and Google doesn't implement it: Search Console has no URL-submission endpoint (its Indexing API covers only job postings and broadcast events). So `seo_submit_urls` refuses on a Google connection with a message naming the vendor, instead of silently no-op'ing or pretending to queue something. Field coverage differs the same way — Bing reports `httpStatus`, `discoveredAt` and `inboundAnchorCount`; Google reports `detail`, its coverage state, which is the single most useful string it has ("Submitted and indexed", "Crawled - currently not indexed"). `detail` is new on `SeoUrlStatus` and null for Bing. A null field means the engine doesn't expose it, not that the value is zero, and the skill and tool descriptions now say so.

**Both engines aggregate identically despite reporting differently.** Google honours an exact date range where Bing returns whole weeks, but the adapter still requests `['date', <dimension>]` and folds rows the same way — impressions and clicks summed per key, `avgPosition` weighted by impressions, `ctr` recomputed after aggregation rather than averaged from per-row values. That keeps the returned `window` honestly derived from the rows present in both adapters, so an agent reading one result cannot tell which engine produced it except by the fields that are null.

Two Google specifics worth recording. The authorize URL sets `access_type=offline` **and** `prompt=consent`, because without forced consent a repeat authorization returns no refresh token and the connection would appear to succeed and then fail on first refresh. And `invalid_grant` on refresh maps to `OAuthGrantRevokedError` while every other token failure stays a vendor error — that distinction is what lets the trunk mark a connection `expired` for a genuinely dead grant without doing so on a transient Google 500.

Property paths are URL-encoded, so both `https://example.com/` and `sc-domain:example.com` properties work.

`webmasters.readonly` is a sensitive scope. An org's own OAuth client works unverified against accounts it owns, which is the self-hosting and single-tenant case; distributing one client to customers requires Google app verification (CASA assessment, privacy policy, demo video).

**Unrelated fix, surfaced by this work:** `runMigrations` now takes a Postgres advisory lock for the duration. Concurrent callers were racing `CREATE EXTENSION IF NOT EXISTS`, which fails with `tuple concurrently updated`. It only bites on a cold database — several integration test files calling `runMigrations` at once — so it never reproduced on a warm local DB and would have shown up as a flaky CI failure in a file unrelated to whatever change added the extra racer. Adding two integration test files here was enough to trigger it.
