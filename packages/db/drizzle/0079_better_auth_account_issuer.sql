-- better-auth 1.7 keys accounts by (issuer, account_id) instead of
-- (provider_id, account_id), and lets the JWKS rows carry their own algorithm.
--
-- `issuer` is NOT NULL upstream, so existing rows are backfilled with the
-- synthetic issuers better-auth derives for providers that have none of their
-- own: `local:<providerId>` for internal credentials, `local:oauth:<providerId>`
-- for OAuth identities. Munin only configures `credential`, `google` and
-- `github`, all of which are URL-encoding-identical to themselves, so plain
-- concatenation matches `encodeURIComponent` here.
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "issuer" text;--> statement-breakpoint
UPDATE "accounts"
SET "issuer" = CASE
  WHEN "provider_id" = 'credential' THEN 'local:credential'
  ELSE 'local:oauth:' || "provider_id"
END
WHERE "issuer" IS NULL;--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "issuer" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "jwks" ADD COLUMN IF NOT EXISTS "alg" text;--> statement-breakpoint
ALTER TABLE "jwks" ADD COLUMN IF NOT EXISTS "crv" text;--> statement-breakpoint
DROP INDEX IF EXISTS "accounts_provider_account_uq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "accounts_issuer_account_uq" ON "accounts" USING btree ("issuer","account_id");
