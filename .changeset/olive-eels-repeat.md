---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
'@getmunin/db': minor
---

Upgrade better-auth to 1.7.1 and clear the open dependency advisories.

`@better-auth/oauth-provider` before 1.7.0-beta.4 could issue access tokens for
unauthorized audiences via unbound resource indicators (GHSA-p2fr-6hmx-4528).
Munin's `/mcp` gates on scope, so a token minted for one resource being accepted
at another is directly on-threat — this is the advisory that mattered, and the
only one reachable outside the build.

1.7 pays for that fix with schema. Two migrations:

- `0079_better_auth_account_issuer` — accounts are now keyed by
  `(issuer, account_id)` rather than `(provider_id, account_id)`. `issuer` is
  NOT NULL upstream, so existing rows are backfilled with the synthetic issuers
  better-auth derives for providers that have none of their own:
  `local:credential` for internal credentials, `local:oauth:<providerId>` for
  Google and GitHub. JWKS rows gain `alg` and `crv`.
- `0080_better_auth_resource_indicators` — the resource-indicator storage the
  fix runs on: an `oauth_resource` registry, an `oauth_client_resource` grant
  table, an `oauth_client_assertion` replay guard, and the columns the provider
  now persists on clients, access tokens and consents. Entirely additive; every
  column is nullable or defaulted, so no backfill.

Both are idempotent, and both were smoke-tested against a database already at
the preceding migration with representative rows, not a fresh one.

Two behaviour changes worth knowing about, both upstream tightening rather than
anything Munin chose:

- Dynamic client registration returns `201 Created`, per RFC 7591 §3.2.1. It
  previously returned `200`.
- A client that registers a loopback redirect URI (`http://localhost:…`) is now
  rejected unless it declares `application_type: "native"`. OIDC defaults an
  omitted `application_type` to `web`, and web clients must use https on a
  non-loopback host. Hosted connectors are unaffected — they redirect over
  https — but a local MCP client that registers `http://localhost:…` without
  declaring itself native will now be turned away at registration.

Also refreshes the stale `brace-expansion` override floors, pins `nanoid` past
GHSA-2v37-7h3g-55p8 and `@hono/node-server` past GHSA-frvp-7c67-39w9, and
deduplicates `@better-auth/utils` to 0.5.0. That last one works around an
upstream contradiction: `@better-auth/core@1.7.1` peer-pins both
`better-call@1.4.0` and `@better-auth/utils@0.4.2`, but `better-call@1.4.0`
itself depends on `@better-auth/utils@^0.5.0`. Left alone, pnpm installs three
copies of `@better-auth/core`, and the duplicate type identities make the
oauth-provider plugin fail to typecheck against `BetterAuthPlugin`.
