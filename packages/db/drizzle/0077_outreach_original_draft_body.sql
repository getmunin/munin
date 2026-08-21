-- Keep the draft as first written when a human edits an outreach proposal.
--
-- applyRevision overwrites draft_body, so the original text was lost the moment
-- anyone touched it. original_draft_body captures it on the first revision made
-- by a signed-in person; null means no human has edited the proposal and
-- draft_body is still the draft as it was proposed.
--
-- Named for the original rather than for who wrote it: proposals are normally
-- drafted by the curator agent, but proposed_by_actor_type can be 'user', and
-- then this column holds a person's text.
--
-- auto_curate_edits gates feeding those edits to KB curation. Outbound copy is
-- edited mostly for personalisation rather than for fact, so it is opt-in per
-- campaign and defaults off.
ALTER TABLE "outreach_campaigns" ADD COLUMN IF NOT EXISTS "auto_curate_edits" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_proposals" ADD COLUMN IF NOT EXISTS "original_draft_body" text;
