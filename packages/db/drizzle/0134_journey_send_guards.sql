-- Journey proposals are unique per step run (outreach_proposals_journey_step_uq);
-- the campaign/contact/kind pair index wrongly blocked a second open journey
-- message to the same person and left the run failing on every tick.
DROP INDEX IF EXISTS "outreach_proposals_open_pair_uq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "outreach_proposals_open_pair_uq" ON "outreach_proposals" USING btree ("campaign_id","contact_id","kind") WHERE status IN ('pending', 'approved') AND kind <> 'journey';--> statement-breakpoint
-- Hash of each auto email step's template at publish, so later template edits
-- send for review instead of going out unseen.
ALTER TABLE "journey_versions" ADD COLUMN IF NOT EXISTS "pinned_templates" jsonb DEFAULT '{}'::jsonb NOT NULL;
