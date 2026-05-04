ALTER TABLE "api_keys"
  ADD COLUMN IF NOT EXISTS "audiences" jsonb NOT NULL DEFAULT '["admin"]'::jsonb;
