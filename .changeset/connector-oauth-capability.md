---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

Teach the connector trunk to authorize by OAuth redirect, not just static credentials.

`ConnectorAdapter` modelled one kind of credential: something a human pastes into the `/connect/credentials` form once. That covers Shopify, Magento, Gastroplanner and Bing, and it cannot express a vendor that hands out a short-lived access token behind a redirect. Adapters now declare an optional `oauth` capability (`authorizeUrl` / `exchangeCode` / `refresh` / `revoke`) and the trunk drives the rest: `connectors_get_authorize_url` mints an HMAC-signed state, `/v1/connectors/oauth/callback` exchanges the code, and `ConnectorOAuthService` owns the tokens from there. Adapters without the capability are untouched.

**The redirect was the easy half.** A refresh is a write on a read path: it happens while a read tool is running, inside that request's tenant transaction, and the new refresh token has to survive even when the vendor call it enabled then fails. So refreshes run in their own root-db transaction under `SELECT … FOR UPDATE` on the connection row, re-reading the grant inside the lock so a parallel instance that already refreshed wins rather than both racing to burn the same token, with an in-process single-flight map collapsing concurrent callers in one process.

The same reasoning has a sharper edge that a test caught: marking a connection `expired` must happen in a **separate committed** transaction. Doing it inside the transaction that then throws rolls the marker back along with the error, so a dead grant would look healthy on the next call and re-fail forever. Refresh failure is now a two-phase operation — release the lock, commit the state change, then raise `connectors_expired` telling the operator to reconnect.

**Two things this changes for every connector.** `credentialState` grows from `active | pending` to `active | pending | expired | revoked`, and `config.oauth` becomes reserved for the trunk — adapters must not touch it. Since `buildStoredConfig` returns a whole new config, the trunk re-attaches the grant after calling it; `publicConfig` being an allow-list is what already keeps token ciphertext out of DTOs, and the `pending` branch of the connection DTO now strips the grant explicitly rather than dumping raw config.

An OAuth connection stays `pending` even once its client secret is stored, because a client secret alone can't call the vendor — so `applyCredentials` no longer runs a connection test it would certainly fail, and instead points at the authorize step. `connectors_delete_connection` revokes the grant at the vendor before deleting the row, and treats a vendor that has already dropped it as success, since the local tokens are gone either way.

Self-hosters can't use Munin's OAuth client, so client id and secret are per-connection config fields rather than deployment env vars.

Two smaller improvements fall out. `connectors_list_vendors` reports which vendors are `oauth`, so an agent can tell the two setup paths apart before creating anything. And `resolveScope` no longer claims "no active connection configured" when one exists but is unusable — it names the connection and its state, so "expired, reconnect it" stops reading like "you never set this up".
