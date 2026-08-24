---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
'@getmunin/ui': minor
---

Show on each data-connection card who can actually reach it.

The Integrations page listed every connector in one undifferentiated section, so nothing told an operator that connecting Bing Webmaster Tools exposes no surface at all to the customer-facing chatbot, while connecting Gastroplanner lets customers cancel their own bookings. That is a material fact when you are about to hand a vendor credential over.

Audience is a property of the domain's tool surface, not of the vendor, so it is derived from `ConnectorDomain` in the backend (`audienceForDomain`) and carried on both the vendor and connection DTOs rather than recomputed in the dashboard. `commerce` and `bookings` ship admin tools and a self-service half, so they read "Customers + team". `seo` is admin-only — its five `seo_*` tools are `audiences: ['admin']`, `seo:read` is absent from both `CONNECTOR_DOMAIN_SCOPES` and `SELF_SERVICE_SCOPES` — so it reads "Team only". Custom MCP servers are proxied only into end-user agent sessions, so they read "Customers only".

No enforcement changes: the audience gate, the connector scope map and the delegated-token scope allow-list already decided this. The badge only makes the existing decision visible.
