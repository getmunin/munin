-- A journey now creates the outreach campaign it sends through, and an event-
-- triggered journey has no audience segment, so a campaign may have none.
ALTER TABLE "outreach_campaigns" ALTER COLUMN "segment_id" DROP NOT NULL;--> statement-breakpoint
-- An archived journey releases its campaign, so a converted campaign can be
-- run by a new journey.
DROP INDEX IF EXISTS "journeys_campaign_uq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "journeys_campaign_uq" ON "journeys" USING btree ("outreach_campaign_id") WHERE status <> 'archived';
