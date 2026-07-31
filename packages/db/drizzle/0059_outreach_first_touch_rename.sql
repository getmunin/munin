-- Rename the first-touch auto-draft flag to match the MCP surface
-- (outreach_propose_first_touch). Idempotent: a re-run after the column has
-- already been renamed is a no-op rather than an error.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'outreach_campaigns' AND column_name = 'auto_draft_initial'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'outreach_campaigns' AND column_name = 'auto_draft_first_touch'
  ) THEN
    ALTER TABLE "outreach_campaigns" RENAME COLUMN "auto_draft_initial" TO "auto_draft_first_touch";
  END IF;
END $$;--> statement-breakpoint
-- curator_jobs rows outlive a release, so both the pointers and the
-- instructions they carry have to follow the rename. The two are treated
-- differently on purpose:
--
--   * job_uri, dedupe_key and source_event_type are identifiers of things that
--     were renamed (a skill, a scheduled sweep). Every row is rewritten so job
--     history stays queryable under the current names and so a pending row
--     still dedupes against the next scheduled enqueue.
--   * user_prompt is the instruction text an agent was handed. Rewriting a
--     finished job's prompt would falsify what it was told, so only 'pending'
--     rows — the ones that will still run, and would otherwise call a tool
--     that no longer exists — are touched.
--
-- curator_jobs is FORCE RLS, so even the table owner needs the bypass GUC.
DO $$
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);

  UPDATE "curator_jobs"
  SET "job_uri" = replace(
        "job_uri",
        'skill://outreach/draft-initial-',
        'skill://outreach/draft-first-touch-'
      )
  WHERE "job_uri" LIKE 'skill://outreach/draft-initial-%';

  UPDATE "curator_jobs"
  SET "dedupe_key" = 'outreach-first-touch:scheduled'
  WHERE "dedupe_key" = 'outreach-draft-initial:scheduled';

  UPDATE "curator_jobs"
  SET "source_event_type" = 'scheduler.curator-outreach-first-touch'
  WHERE "source_event_type" = 'scheduler.curator-outreach-draft-initial';

  UPDATE "curator_jobs"
  SET "user_prompt" = replace(
        "user_prompt",
        'outreach_propose_initial_message',
        'outreach_propose_first_touch'
      )
  WHERE "status" = 'pending'
    AND "user_prompt" LIKE '%outreach_propose_initial_message%';

  UPDATE "curator_jobs"
  SET "user_prompt" = replace(
        "user_prompt",
        'skill://outreach/draft-initial-',
        'skill://outreach/draft-first-touch-'
      )
  WHERE "status" = 'pending'
    AND "user_prompt" LIKE '%skill://outreach/draft-initial-%';
END $$;
