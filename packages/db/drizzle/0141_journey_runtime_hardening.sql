-- A step that keeps throwing used to retry every minute forever. Runs now
-- count consecutive step errors and end with `step_failed` after a limit;
-- the last error is kept for the trace.
ALTER TABLE "journey_enrollments" ADD COLUMN IF NOT EXISTS "step_errors" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "journey_enrollments" ADD COLUMN IF NOT EXISTS "last_error" text;--> statement-breakpoint
-- Scheduled segment entry pages through the segment by id. The cursor keeps
-- the position between ticks so members that are skipped (not eligible, at
-- the concurrency cap) are not selected again on every tick.
ALTER TABLE "journeys" ADD COLUMN IF NOT EXISTS "entry_cursor" text;
