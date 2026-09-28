-- An org's uploaded logo. The bytes live in asset storage under
-- logo_storage_key; logo_mime is what the public logo endpoint serves them as,
-- and logo_updated_at versions the public URL so a replaced logo busts caches.
-- All three are NULL until a logo is uploaded and go back to NULL on removal.
ALTER TABLE "orgs" ADD COLUMN IF NOT EXISTS "logo_storage_key" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN IF NOT EXISTS "logo_mime" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN IF NOT EXISTS "logo_updated_at" timestamp with time zone;
