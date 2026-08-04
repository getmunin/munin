-- Approving an outreach proposal can now authorize a send for later instead of
-- sending inline: 'approved' rows carry the authorized send time and the send
-- worker drains them when due. send_attempts bounds retries on transient
-- delivery failures so a broken mailbox cannot re-send forever.
ALTER TABLE "outreach_proposals" ADD COLUMN IF NOT EXISTS "scheduled_send_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outreach_proposals" ADD COLUMN IF NOT EXISTS "send_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_proposals_scheduled_send_idx" ON "outreach_proposals" USING btree ("scheduled_send_at") WHERE status = 'approved';--> statement-breakpoint
-- The one-in-flight-proposal-per-(campaign, contact, kind) guard has to count
-- scheduled proposals too, or a curator could file a fresh draft for a contact
-- who already has an approved send waiting and reach them twice. Decided rows
-- (sent / failed / dismissed / withdrawn) stay outside the predicate so a
-- contact can be re-drafted after a decision.
DROP INDEX IF EXISTS "outreach_proposals_pending_pair_uq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "outreach_proposals_open_pair_uq" ON "outreach_proposals" USING btree ("campaign_id","contact_id","kind") WHERE status IN ('pending', 'approved');
