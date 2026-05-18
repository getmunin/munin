ALTER TABLE "conv_channels" ADD COLUMN "vendor" varchar(32);

UPDATE "conv_channels"
SET "vendor" = CASE
  WHEN "type" = 'email' THEN COALESCE(NULLIF(config #>> '{outbound,provider}', ''), 'smtp')
  WHEN "type" = 'chat' THEN 'munin'
  ELSE 'unknown'
END
WHERE "vendor" IS NULL;

ALTER TABLE "conv_channels" ALTER COLUMN "vendor" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "conv_channels_type_vendor_idx"
  ON "conv_channels" ("org_id", "type", "vendor");
