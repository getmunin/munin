-- Journeys stop borrowing an outreach campaign to send through. A journey
-- names its own sender channel, and its proposals point at the journey
-- instead of a campaign. Journeys converted from a campaign keep that link
-- (the campaign stops proposing while the journey runs), and proposals filed
-- before this keep their campaign id, so nothing already sent changes.
ALTER TABLE "journeys" ADD COLUMN IF NOT EXISTS "sender_channel_id" text;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journeys_sender_channel_id_conv_channels_id_fk') THEN
    ALTER TABLE "journeys" ADD CONSTRAINT "journeys_sender_channel_id_conv_channels_id_fk"
      FOREIGN KEY ("sender_channel_id") REFERENCES "conv_channels"("id") ON DELETE SET NULL;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "journeys" ALTER COLUMN "outreach_campaign_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_proposals" ADD COLUMN IF NOT EXISTS "journey_id" text;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outreach_proposals_journey_id_journeys_id_fk') THEN
    ALTER TABLE "outreach_proposals" ADD CONSTRAINT "outreach_proposals_journey_id_journeys_id_fk"
      FOREIGN KEY ("journey_id") REFERENCES "journeys"("id") ON DELETE CASCADE;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "outreach_proposals" ALTER COLUMN "campaign_id" DROP NOT NULL;--> statement-breakpoint
DO $$
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);
  UPDATE "journeys" j
     SET "sender_channel_id" = c."channel_id"
    FROM "outreach_campaigns" c
   WHERE c."id" = j."outreach_campaign_id" AND j."sender_channel_id" IS NULL;
  UPDATE "outreach_proposals" p
     SET "journey_id" = e."journey_id"
    FROM "journey_enrollments" e
   WHERE p."kind" = 'journey' AND p."journey_id" IS NULL AND e."id" = p."journey_enrollment_id";
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_proposals_journey_idx" ON "outreach_proposals" USING btree ("journey_id");--> statement-breakpoint
ALTER TABLE "outreach_proposals" DROP CONSTRAINT IF EXISTS "outreach_proposals_owner_ck";--> statement-breakpoint
ALTER TABLE "outreach_proposals" ADD CONSTRAINT "outreach_proposals_owner_ck"
  CHECK ("campaign_id" IS NOT NULL OR ("kind" = 'journey' AND "journey_id" IS NOT NULL));
