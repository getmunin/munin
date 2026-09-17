---
'@getmunin/backend-core': patch
---

Extract the outbound OAuth grant machinery out of the connectors trunk.

Munin plays two OAuth roles that share a name and nothing else. `src/oauth/` is
Munin *as* an authorization server — MCP clients register there and get tokens.
The code moved here is the other direction: grants Munin *holds* on someone
else's authorization server, which until now lived entirely inside
`connector-oauth.service.ts` and was reachable only through a connector.

`src/common/outbound-oauth/` now holds the parts that are about grants rather
than about connectors:

- **`grant.ts`** — the stored-grant shape, parsing, the freshness check with its
  60-second skew, and the rule that a vendor rotating only its access token must
  not cost you the refresh token you already hold.
- **`signed-state.ts`** — HMAC-signed state with the expiry check, over an
  arbitrary payload rather than a hardcoded `{connectionId, orgId}`.
- **`single-flight.ts`** — one in-flight refresh per key.
- **`grant-store.ts`** — the pgcrypto encrypt/decrypt round trip, the root-db
  transaction that sets `bypass_rls`, and `resolveOrMarkRevoked`.

`resolveOrMarkRevoked` exists to name an invariant that is invisible at the call
site and expensive to rediscover: **marking a grant expired has to commit in its
own transaction.** Doing it inside the transaction you then throw out of rolls
the marker back with the error, so the connection reports healthy and fails again
on the next call. That was already correct here; it was correct by arrangement,
not by construction, and the next caller had no way to know.

This is a pure refactor and the evidence is that
`connector-oauth.service.test.ts` — all fourteen cases, covering exchange,
refresh, rotation, racing callers, revocation and cross-org access — still
passes with **one line changed**, and that line is the constructor call. The
service now takes an `OutboundOAuthStore` where it took a `Db`.

The extracted pieces gained their own tests (31), which is most of the point:
the skew window, the refresh-token carry-forward and the revocation ordering
were previously reachable only through a Postgres-backed integration test that
had to stand up a connection row to assert one comparison.

One deliberate non-change: the shared cipher throws `SecretCipherError` rather
than the connectors' `ConnectorVendorError`, and `vendorCall` maps it to the same
`BadGatewayException` it produced before. A failure to decrypt our own column is
not really a vendor error and 502 is not really the right status, but fixing that
is a behaviour change and this PR is not the place to make one.
