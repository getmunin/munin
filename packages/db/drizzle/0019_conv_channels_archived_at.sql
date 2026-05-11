ALTER TABLE "conv_channels"
  ADD COLUMN IF NOT EXISTS "archived_at" timestamptz;
