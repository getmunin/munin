-- Drop the legacy `oauth_clients` table and its dormant FK from `tokens`.
--
-- Historical context: we shipped our own minimal OAuth client model in
-- `oauth_clients` (migration 0000) before adopting `@better-auth/oauth-provider`
-- in 0017/0018, which insists on owning its own table (`oauth_client`,
-- singular). The legacy table was kept around because `tokens` had a FK
-- pointing at it, but nothing actually writes either side: BetterAuth uses
-- `oauth_client`, and `tokens.oauth_client_id` has only ever held NULL.
--
-- Both `oauth_clients` and `tokens.oauth_client_id` are confirmed empty in
-- dev and prod at the time of this migration.

ALTER TABLE "tokens" DROP CONSTRAINT IF EXISTS "tokens_oauth_client_id_oauth_clients_id_fk";
ALTER TABLE "tokens" DROP COLUMN IF EXISTS "oauth_client_id";

DROP INDEX IF EXISTS "oauth_clients_org_idx";
DROP TABLE IF EXISTS "oauth_clients";
