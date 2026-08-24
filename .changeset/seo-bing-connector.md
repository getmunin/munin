---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

Add a search-console connector domain (`seo`) with Bing Webmaster Tools behind it.

Munin's analytics answer the post-click half of a traffic question — which pages got viewed, where visitors came from, what they searched for on the site and found nothing. A search console answers the pre-click half: what people typed, how often the site was shown, and where it ranked. The point of connecting one is that the same agent can then act on the gap, because Munin already owns the fix (`cms_update_entry`, `kb_create_document`) and now owns a write verb to ask for a recrawl. `skill://seo/improve-search-performance` walks that loop end to end.

Five admin-only tools on the new `seo:read` / `seo:write` scopes: `seo_list_properties`, `seo_list_queries`, `seo_list_pages`, `seo_inspect_url`, and `seo_submit_urls`. No self-service half — no end user asks about impressions or average position — and no DB work: `connector_connections.domain` is free-text `varchar(32)` and its RLS policy is domain-agnostic, so the new domain is a union widening, not a migration.

Three things this design commits to, all consequences of search-console data behaving unlike every connector already in the trunk:

**Reads stay live; nothing is cached.** Bing publishes no per-day ceiling on `GetQueryStats`-style reads (throttling exists and surfaces as `ErrorCode` 4, now mapped to a `502` naming the throttle rather than a bare `500`), so there is no quota argument for persisting vendor data. The real constraint is shape, not volume: `GetQueryStats` takes no date-range parameters and returns every week Bing holds on each call, so windowing and top-N truncation happen in the adapter. Trend-over-time would need history the vendor won't hand over retroactively, and that is a deliberate feature with its own table — not an optimization to smuggle in here.

**The window reported is the window covered.** Bing aggregates into whole weeks ending Friday and lags 2–3 days, so results are aggregated per query across the requested range — impressions and clicks summed, `avgPosition` weighted by impressions — and the response carries the range actually covered, `null` when nothing fell in range. Echoing back the requested `from`/`to` would have read as precision the data doesn't have.

**Cardinality is new.** A commerce connection is one store; a search-console connection is one account holding many verified properties. So every verb takes a `siteUrl`, resolved the way `connectionId` already is: omit it when unambiguous, and when several are verified the error names them. `seo_submit_urls` additionally refuses URLs outside the resolved property, and pre-checks the vendor's remaining daily and monthly quota so an over-budget batch is rejected whole rather than partially submitted — a client error, not a gateway error.

Adding `'seo'` to `ConnectorDomain` deliberately breaks the exhaustive domain map behind the voice self-service tool gate. That map now enumerates self-service domains only, so an operator-facing domain cannot reach an end-user surface by being forgotten; `seo:*` scopes are likewise absent from `SELF_SERVICE_SCOPES` and `CONNECTOR_DOMAIN_SCOPES`.

Google Search Console fits the same `SeoAdapter` contract but is not included: it is OAuth-only, and `ConnectorAdapter` models static credentials exclusively — no authorize redirect, no refresh rotation, no revocation. That belongs in the trunk as its own change, where the hard part is not the redirect but that a token refresh is a write on a read path inside the request's tenant transaction.
