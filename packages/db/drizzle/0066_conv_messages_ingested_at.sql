-- conv_messages.created_at is the display clock ("when this was said") and voice
-- adapters backdate it to the spoken turn order. The widget's incremental fetch
-- needs a strictly monotonic arrival clock instead, or a backdated row lands
-- below the client's high-water cursor and is never delivered.
--
-- Added nullable + backfilled from created_at rather than in one ALTER: a
-- volatile DEFAULT (clock_timestamp) is evaluated per row during the table
-- rewrite, which would stamp every pre-existing message with the migration's
-- own wall clock and destroy the arrival ordering we are trying to preserve.
--
-- conv_messages is FORCE ROW LEVEL SECURITY, which applies to the table owner
-- too, so the backfill runs inside a bypass_rls block. Without it the UPDATE
-- matches no rows on an existing deploy and the SET NOT NULL below fails.
ALTER TABLE "conv_messages" ADD COLUMN IF NOT EXISTS "ingested_at" timestamp with time zone;--> statement-breakpoint
DO $$
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);
  UPDATE "conv_messages" SET "ingested_at" = "created_at" WHERE "ingested_at" IS NULL;
END $$;--> statement-breakpoint
ALTER TABLE "conv_messages" ALTER COLUMN "ingested_at" SET DEFAULT clock_timestamp();--> statement-breakpoint
ALTER TABLE "conv_messages" ALTER COLUMN "ingested_at" SET NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conv_messages_ingested_idx" ON "conv_messages" USING btree ("conversation_id","ingested_at");
