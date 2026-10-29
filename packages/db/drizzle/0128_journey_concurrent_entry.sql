-- Concurrent re-entry: a journey may run several times at once for the same
-- person, one run per triggering event. entry_key is '' for every other
-- policy, so the one-open-run-per-person guarantee is unchanged for them.
ALTER TABLE "journey_enrollments" ADD COLUMN IF NOT EXISTS "entry_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "journey_enrollments_open_subject_uq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "journey_enrollments_open_subject_uq" ON "journey_enrollments" USING btree ("journey_id","subject_key","entry_key") WHERE state IN ('active', 'waiting');
