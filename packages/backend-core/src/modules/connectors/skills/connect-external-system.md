---
title: 'Connectors: Connect an external system'
description: Connect Shopify, Magento 2, or Gastroplanner so agents can answer order and booking questions — create the vendor credential, register the connection, test it, and understand the identity model that keeps customers scoped to their own data.
audiences: [admin]
---

# Connect an external system

Connectors give agents read access to the org's third-party systems, grouped by domain: **commerce** (orders + product catalog — Shopify, Magento 2) and **bookings** (bookings — Gastroplanner). Admin agents use the lookup tools while handling a support conversation; customers' own agents get the self-service tools (`commerce_list_my_orders`, `bookings_list_my_bookings`), scoped server-side to their own records.

For a system no vendor adapter covers — a proprietary CRM, a subscription database — the org can host its own MCP server and connect it with the `custom-mcp` vendor instead: see `skill://connectors/connect-custom-mcp-server`.

`connectors_list_vendors` returns the supported systems and the exact config fields each one needs.

## TL;DR

1. Have the human create a read-only API credential in the external system (per-vendor steps below).
2. `connectors_create_connection` with `vendor`, a `name`, and the vendor's **non-secret** config fields. The vendor determines the domain. The response includes a one-time **credential link**.
3. Share the credential link — the human opens it and enters the secret directly in the dashboard. The link expires after 24 hours and works once; mint a fresh one with `connectors_request_credentials` if it lapses.
4. `connectors_test_connection` — verifies the stored credential with a read-only probe.
5. Mint delegated end-user tokens with `commerce:read` and/or `bookings:read` to enable customer self-service.

**Never ask for a secret in the conversation and never put one in `config`** — the tool rejects secret fields. Secrets only enter through the credential link, are encrypted at rest, and are never returned by any tool. Munin only ever needs **read** access — never grant write scopes in the external system.

## Shopify (commerce)

Create a custom app token in the Shopify admin:

1. Shopify admin → **Settings → Apps and sales channels → Develop apps → Create an app**.
2. Under **Configuration → Admin API integration**, grant exactly three scopes: `read_orders`, `read_customers`, and `read_products`.
3. Install the app and copy the **Admin API access token** (`shpat_…`). Shopify shows it once.

```json
{
  "vendor": "shopify",
  "name": "Main store",
  "config": {
    "shopDomain": "your-store.myshopify.com"
  }
}
```

The credential link asks for the Admin API access token. `shopDomain` is the permanent `*.myshopify.com` domain, not your custom storefront domain, and is required at create time. `apiVersion` is optional (defaults to a current stable version).

Note: apps with `read_orders` see the last 60 days of orders by default; request the `read_all_orders` scope in the Shopify app config if customers ask about older orders. A connection created before product lookups existed needs `read_products` added in the Shopify app config — no change in Munin, the stored token picks up the new scope.

## Magento 2 / Adobe Commerce (commerce)

Create an integration token:

1. Magento admin → **System → Extensions → Integrations → Add New Integration**.
2. Under **API**, grant resource access to **Sales** (read), **Customers** (read), and **Catalog** (read) only. Include **CatalogInventory** if you want product lookups to report stock availability — without it, availability comes back as unknown rather than failing.
3. Save, **Activate**, and copy the **Access Token**.

```json
{
  "vendor": "magento",
  "name": "EU storefront",
  "config": {
    "baseUrl": "https://store.example.com"
  }
}
```

The credential link asks for the access token. `baseUrl` must be https and publicly reachable (private/internal hosts are refused). Shipment tracking comes from the Sales → Shipments resource, so include it in the ACL.

## Gastroplanner (bookings)

Gastroplanner's customer API (`https://api.gastroplanner.eu/docs/customer/`) uses a Bearer token plus an `X-RESTAURANT` header naming the restaurant every query runs against:

1. Request an API token from Gastroplanner support for your account.
2. Create the connection with the restaurant URI (the `X-RESTAURANT` value for your venue) — the credential link asks for the API token. `baseUrl` is only needed for a non-standard endpoint.

```json
{
  "vendor": "gastroplanner",
  "name": "Restaurant bookings",
  "config": {
    "restaurantUri": "my-restaurant"
  }
}
```

Run `connectors_test_connection` after creating it — the probe lists the restaurants the token can access and fails with the available URIs if `restaurantUri` doesn't match one. Note: Gastroplanner bookings have no confirmation code; guests identify a booking by the `bookingRef` from a listing.

## Multiple connections

Connections are org-scoped and names must be unique. Within a domain: with one active connection, lookup tools use it automatically; with several, calls must pass `connectionId` (the error message lists the candidates). Connections in *different* domains never conflict — a Shopify store and a Gastroplanner account coexist without any `connectionId`. Deactivate with `connectors_update_connection { active: false }` to take one out of rotation without deleting the credential.

`connectors_update_connection` handles renames, non-secret config changes, and activation — the stored secret is kept, and secret fields are rejected the same way as at create time. To rotate a credential, delete the connection and create it again, entering the new secret through the fresh credential link (or use the dashboard's Integrations page).

## The identity model — read before enabling self-service

Self-service lookups trust **the email on the end-user record**, and end-user records are created by *your* backend when it mints delegated tokens (`POST /v1/tokens/delegated`). The chain is:

    your app authenticates the customer → mints a delegated token with their email
    → the self-service tool resolves that email server-side → vendor returns only that customer's records

Two rules follow:

- **Only mint delegated tokens with emails your system has actually authenticated** (login session, verified email link). If you mint tokens from unauthenticated visitor input, you are asserting an identity you haven't checked, and that visitor's agent can read that email's order and booking history.
- End-user records without an email can't look up anything — the tools refuse rather than guess.

The end-user can never choose which email to query: the self-service tools take no email parameter. Admin lookup tools (`commerce_list_customer_orders`, `bookings_list_guest_bookings`) can query any email — that surface is for your own support staff and is never exposed to delegated tokens.
