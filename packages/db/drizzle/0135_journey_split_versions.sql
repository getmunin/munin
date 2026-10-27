-- Step runs record the version they ran on, so moving a run to a new version
-- does not carry its old split assignments into the new version's sample.
ALTER TABLE "journey_step_runs" ADD COLUMN IF NOT EXISTS "version" integer;--> statement-breakpoint
DO $$
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);
  UPDATE "journey_step_runs" s SET "version" = en."version"
    FROM "journey_enrollments" en
   WHERE s."enrollment_id" = en."id" AND s."version" IS NULL;
END $$;--> statement-breakpoint
-- When a person resumes a step or journey the monitor paused, rates restart
-- from that moment instead of re-tripping on the same week of data.
ALTER TABLE "journeys" ADD COLUMN IF NOT EXISTS "guardrail_resets" jsonb DEFAULT '{}'::jsonb NOT NULL;
