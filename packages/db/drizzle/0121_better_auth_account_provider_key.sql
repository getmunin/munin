-- better-auth 1.7.3 reverted the 1.7.0 account identity change: accounts are
-- keyed by (provider_id, account_id) again, as in 1.6, and `issuer` is no
-- longer written. 0079 made `issuer` NOT NULL, so on 1.7.3+ every sign-up and
-- account link would fail until the constraint is relaxed.
--
-- The 1.6 unique index is restored in place of the issuer one. It cannot hit
-- duplicates: 0079 derived `issuer` one-to-one from `provider_id`, so
-- (issuer, account_id) being unique already implies (provider_id, account_id)
-- is.
--
-- The column itself is kept, nullable, so existing rows keep their issuer if
-- a deploy has to roll back to better-auth 1.7.2. Dropping it is later cleanup.
ALTER TABLE "accounts" ALTER COLUMN "issuer" DROP NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "accounts_issuer_account_uq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accounts_provider_account_uq" ON "accounts" USING btree ("provider_id","account_id");
