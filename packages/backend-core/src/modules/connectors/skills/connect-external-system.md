---
title: 'Connectors: Connect an external system'
description: Connect Shopify, Magento 2, or Gastroplanner so agents can answer order and reservation questions — create the vendor credential, register the connection, test it, and understand the identity model that keeps customers scoped to their own data.
audiences: [admin]
---

# Connect an external system

Connectors give agents read access to the org's third-party systems, grouped by domain: **commerce** (orders — Shopify, Magento 2) and **bookings** (reservations — Gastroplanner). Admin agents use the lookup tools while handling a support conversation; customers' own agents get the self-service tools (`commerce_get_my_orders`, `bookings_get_my_reservations`), scoped server-side to their own records.

`connectors_list_vendors` returns the supported systems and the exact config fields each one needs.

## TL;DR

1. Create a read-only API credential in the external system (per-vendor steps below).
2. `connectors_create_connection` with `vendor`, a `name`, and the vendor config. The vendor determines the domain.
3. `connectors_test_connection` — verifies the credential with a read-only probe.
4. Mint delegated end-user tokens with `commerce:read` and/or `bookings:read` to enable customer self-service.

Secrets are encrypted at rest and never returned by any tool. Munin only ever needs **read** access — never grant write scopes in the external system.

## Shopify (commerce)

Create a custom app token in the Shopify admin:

1. Shopify admin → **Settings → Apps and sales channels → Develop apps → Create an app**.
2. Under **Configuration → Admin API integration**, grant exactly two scopes: `read_orders` and `read_customers`.
3. Install the app and copy the **Admin API access token** (`shpat_…`). Shopify shows it once.

```json
{
  "vendor": "shopify",
  "name": "Main store",
  "config": {
    "shopDomain": "your-store.myshopify.com",
    "accessToken": "shpat_…"
  }
}
```

`shopDomain` is the permanent `*.myshopify.com` domain, not your custom storefront domain. `apiVersion` is optional (defaults to a current stable version).

Note: apps with `read_orders` see the last 60 days of orders by default; request the `read_all_orders` scope in the Shopify app config if customers ask about older orders.

## Magento 2 / Adobe Commerce (commerce)

Create an integration token:

1. Magento admin → **System → Extensions → Integrations → Add New Integration**.
2. Under **API**, grant resource access to **Sales** (read) and **Customers** (read) only.
3. Save, **Activate**, and copy the **Access Token**.

```json
{
  "vendor": "magento",
  "name": "EU storefront",
  "config": {
    "baseUrl": "https://store.example.com",
    "accessToken": "…"
  }
}
```

`baseUrl` must be https and publicly reachable (private/internal hosts are refused). Shipment tracking comes from the Sales → Shipments resource, so include it in the ACL.

## Gastroplanner (bookings)

Gastroplanner's partner API uses a token issued by their team:

1. Email **support@gastroplanner.no** and request an API token for your account.
2. Create the connection with the token; `baseUrl` is only needed if Gastroplanner gives you a non-standard endpoint.

```json
{
  "vendor": "gastroplanner",
  "name": "Restaurant bookings",
  "config": {
    "apiToken": "…"
  }
}
```

Run `connectors_test_connection` after creating it — the partner API is not publicly documented, and the test probe is the fastest way to confirm the token and endpoint work for your account.

## Multiple connections

Connections are org-scoped and names must be unique. Within a domain: with one active connection, lookup tools use it automatically; with several, calls must pass `connectionId` (the error message lists the candidates). Connections in *different* domains never conflict — a Shopify store and a Gastroplanner account coexist without any `connectionId`. Deactivate with `connectors_update_connection { active: false }` to take one out of rotation without deleting the credential.

To rotate a credential, call `connectors_update_connection` with the full vendor config including the new token. Omitting the token field keeps the stored one — so renames and URL changes don't require re-entering secrets.

## The identity model — read before enabling self-service

Self-service lookups trust **the email on the end-user record**, and end-user records are created by *your* backend when it mints delegated tokens (`POST /v1/tokens/delegated`). The chain is:

    your app authenticates the customer → mints a delegated token with their email
    → the self-service tool resolves that email server-side → vendor returns only that customer's records

Two rules follow:

- **Only mint delegated tokens with emails your system has actually authenticated** (login session, verified email link). If you mint tokens from unauthenticated visitor input, you are asserting an identity you haven't checked, and that visitor's agent can read that email's order and reservation history.
- End-user records without an email can't look up anything — the tools refuse rather than guess.

The end-user can never choose which email to query: the self-service tools take no email parameter. Admin lookup tools (`commerce_lookup_orders`, `bookings_lookup_reservations`) can query any email — that surface is for your own support staff and is never exposed to delegated tokens.
