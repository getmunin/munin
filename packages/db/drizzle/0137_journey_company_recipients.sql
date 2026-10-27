-- A company journey's message step writes to several people at the company,
-- one proposal each, so a step run is unique per contact rather than alone.
CREATE UNIQUE INDEX IF NOT EXISTS "outreach_proposals_journey_step_contact_uq" ON "outreach_proposals" USING btree ("journey_step_run_id","contact_id") WHERE journey_step_run_id IS NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "outreach_proposals_journey_step_uq";
