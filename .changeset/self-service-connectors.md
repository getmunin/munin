---
'@getmunin/backend-core': minor
'@getmunin/db': minor
---

New `connectors` module: encrypted connections to third-party systems behind a vendor-adapter contract, organized as a domain-agnostic trunk (`connectors_*` tools for connection CRUD + credential testing, `connectors:read`/`connectors:write` scopes, `connector_connections` table with RLS) plus per-domain submodules with typed read surfaces. Commerce domain (Shopify Admin GraphQL, Magento 2 REST): `commerce_lookup_orders`/`commerce_lookup_order` for admins and self-service `commerce_get_my_orders`/`commerce_get_my_order`. Bookings domain (Gastroplanner): `bookings_lookup_reservations`/`bookings_lookup_reservation` and self-service `bookings_get_my_reservations`/`bookings_get_my_reservation`. All self-service lookups are scoped server-side to the calling end-user's own email, so delegated tokens (mintable with `commerce:read`/`bookings:read`) can only ever see their own records. Skills: `skill://connectors/connect-external-system`, `skill://commerce/check-order-status`, `skill://bookings/check-reservation-status`.
