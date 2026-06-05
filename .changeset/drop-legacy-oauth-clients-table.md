---
'@getmunin/db': minor
'@getmunin/backend-core': patch
---

Drop the legacy `oauth_clients` (plural) table and its dormant FK column `tokens.oauth_client_id`.

`oauth_clients` predates the BetterAuth OAuth provider plugin we adopted in migration 0017/0018. Since then the real OAuth client model has lived in `oauth_client` (singular) — that's the table the consent page reads from, the table DCR writes into, and the table FK'd by `oauth_access_token` / `oauth_refresh_token` / `oauth_consent`. The legacy `oauth_clients` was kept around because `tokens.oauth_client_id` had an FK pointing at it, but nothing has ever written either side: BetterAuth uses its own table, and `tokens.oauth_client_id` has only ever held NULL.

Both `oauth_clients` and `tokens.oauth_client_id` were verified empty in dev and prod before the drop. The new migration `0037_drop_legacy_oauth_clients.sql` drops the FK, the column, the index, and the table; `src/sql/rls.sql` loses the matching RLS block; `schema.ts` loses the `oauthClients` export and the `oauthClientId` field on `tokens`.

No application-level changes — nothing referenced the dropped column or table.
