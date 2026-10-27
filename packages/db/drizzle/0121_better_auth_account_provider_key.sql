-- better-auth 1.7.3 reverted the 1.7.0 account identity change: accounts are
-- keyed by (provider_id, account_id) again, as in 1.6, and `issuer` is no
-- longer written. 0079 made `issuer` NOT NULL, so on 1.7.3+ every sign-up and
-- account link would fail until the constraint is relaxed.
--
-- The 1.6 unique index cannot simply be restored. 0079 backfilled Google rows
-- with the synthetic issuer `local:oauth:google`, but better-auth 1.7.1-1.7.2
-- looked Google accounts up under their real issuer,
-- `https://accounts.google.com`. A returning Google user therefore missed the
-- backfilled row and got a second one linked: same user, same provider_id and
-- account_id, different issuer. Those pairs are collapsed to the most recently
-- updated row, which holds the current tokens.
--
-- Duplicate keys that belong to different users cannot be merged blindly. The
-- migration stops instead, and since pending migrations run in one
-- transaction nothing above is applied either.
--
-- The column itself is kept, nullable, so existing rows keep their issuer if
-- a deploy has to roll back to better-auth 1.7.2. Dropping it is later cleanup.
ALTER TABLE "accounts" ALTER COLUMN "issuer" DROP NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "accounts_issuer_account_uq";--> statement-breakpoint
DO $$
DECLARE
  conflicts integer;
BEGIN
  SELECT count(*) INTO conflicts FROM (
    SELECT 1 FROM "accounts"
    GROUP BY "provider_id", "account_id"
    HAVING count(DISTINCT "user_id") > 1
  ) c;
  IF conflicts > 0 THEN
    RAISE EXCEPTION 'accounts: % (provider_id, account_id) keys are linked to more than one user; resolve them before applying 0121', conflicts;
  END IF;
END $$;--> statement-breakpoint
DELETE FROM "accounts" a
USING "accounts" b
WHERE a."provider_id" = b."provider_id"
  AND a."account_id" = b."account_id"
  AND a."user_id" = b."user_id"
  AND (a."updated_at", a."id") < (b."updated_at", b."id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accounts_provider_account_uq" ON "accounts" USING btree ("provider_id","account_id");
