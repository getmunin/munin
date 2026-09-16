-- Keep a durable record of every review-queue decision, for the console's Decided tab.
--
-- The tab promises "everything you publish or dismiss", but only KB curation could
-- deliver it: kb_curation_decisions is a purpose-built record, and crm_merge_proposals
-- and outreach_proposals already carry status + dismiss_reason + decided_by + decided_at.
-- Two kinds could not answer "who decided this, when, and why":
--
--   cms_entries  — archiving recorded nothing but updated_at, which any later edit
--                  overwrites, so an archived entry could not be placed in time.
--   feedback_outbox — the row was hard-deleted on dismissal and on a successful
--                  forward, so a decided item left no trace at all.
--
-- feedback_outbox.status is what the forward worker now filters on; before this, the
-- delete was the only thing keeping an approved item from being forwarded twice.
-- Existing rows default to 'pending', which is correct: a row that survived until now
-- is either awaiting a decision or awaiting a forward retry.
--
-- Re-runnable: every statement is guarded, and the archived_at backfill only fills
-- nulls. It reads and writes a FORCE-RLS table, so it runs with app.bypass_rls set —
-- without it the UPDATE silently matches nothing on a real deploy.

ALTER TABLE "cms_entries" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cms_entries" ADD COLUMN IF NOT EXISTS "dismiss_reason" text;--> statement-breakpoint
ALTER TABLE "feedback_outbox" ADD COLUMN IF NOT EXISTS "status" varchar(16) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback_outbox" ADD COLUMN IF NOT EXISTS "dismiss_reason" text;--> statement-breakpoint
ALTER TABLE "feedback_outbox" ADD COLUMN IF NOT EXISTS "decided_by_actor_type" varchar(16);--> statement-breakpoint
ALTER TABLE "feedback_outbox" ADD COLUMN IF NOT EXISTS "decided_by_actor_id" text;--> statement-breakpoint
ALTER TABLE "feedback_outbox" ADD COLUMN IF NOT EXISTS "decided_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cms_entries_decided_idx" ON "cms_entries" USING btree ("org_id","status",coalesce(published_at, archived_at) desc);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_outbox_org_status_idx" ON "feedback_outbox" USING btree ("org_id","status","decided_at");--> statement-breakpoint

-- Date the entries archived before this migration. updated_at is the best evidence
-- available: for an archived entry it is the archival write, unless someone edited it
-- afterwards, which the dashboard offers no way to do.
DO $$
DECLARE
  v_dated integer := 0;
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);

  UPDATE cms_entries
     SET archived_at = updated_at
   WHERE status = 'archived'
     AND archived_at IS NULL;

  GET DIAGNOSTICS v_dated = ROW_COUNT;
  RAISE NOTICE 'dated % archived cms entries', v_dated;
END $$;
