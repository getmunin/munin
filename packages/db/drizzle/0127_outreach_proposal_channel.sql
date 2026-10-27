-- A proposal may send through a different channel than its campaign: an SMS
-- step in a journey that wraps an email campaign. Null means the campaign's.
ALTER TABLE "outreach_proposals" ADD COLUMN IF NOT EXISTS "channel_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_proposals" ADD CONSTRAINT "outreach_proposals_channel_id_conv_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."conv_channels"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
