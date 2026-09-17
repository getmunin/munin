-- When the stored client secret was last written. Distinct from updated_at,
-- which also moves when only the client id is edited, so the dashboard can say
-- "saved <date>" about the secret itself without overstating it.
ALTER TABLE "social_platform_apps" ADD COLUMN IF NOT EXISTS "client_secret_set_at" timestamp with time zone;

-- Existing rows got their secret at the last write we know of.
UPDATE "social_platform_apps" SET "client_secret_set_at" = "updated_at"
 WHERE "client_secret_set_at" IS NULL;
