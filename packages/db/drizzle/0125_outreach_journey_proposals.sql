-- Journey message nodes file outreach proposals with kind 'journey', linked
-- to the enrollment and the step run that drafted them. One proposal per
-- step run is the database-level guard against a journey sending twice.
ALTER TABLE "outreach_proposals" ADD COLUMN IF NOT EXISTS "journey_enrollment_id" text;--> statement-breakpoint
ALTER TABLE "outreach_proposals" ADD COLUMN IF NOT EXISTS "journey_step_run_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "outreach_proposals_journey_step_uq" ON "outreach_proposals" USING btree ("journey_step_run_id") WHERE journey_step_run_id IS NOT NULL;
