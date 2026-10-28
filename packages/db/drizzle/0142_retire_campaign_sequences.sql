-- Campaign follow-up sequences are retired in favour of journeys. Nothing
-- drafts follow-ups any more, so queued runs of the retired skill are
-- closed, and every enabled campaign that still lists sequence steps (and
-- is not already run by a journey) gets one alert saying its follow-ups
-- stopped and how to keep them going. The sequence_steps column stays: a
-- journey created from the campaign reads it.
DO $$
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);

  UPDATE "curator_jobs"
     SET "status" = 'dead',
         "last_error" = 'skill://outreach/draft-followup-email was retired; follow-up sequences are journeys now',
         "updated_at" = now()
   WHERE "job_uri" = 'skill://outreach/draft-followup-email'
     AND "status" IN ('pending', 'failed_retryable');

  INSERT INTO "org_alerts" ("id", "org_id", "source", "subject_id", "severity", "title", "detail", "metadata", "cta_href")
  SELECT 'alr_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 22),
         c."org_id",
         'journeys',
         c."id" || ':sequence_retired',
         'warning',
         'Campaign "' || c."name" || '" no longer sends follow-ups',
         'Its ' || jsonb_array_length(c."sequence_steps") || ' follow-up step(s) stopped when campaign sequences were replaced by journeys. '
           || 'First touches still go out. To keep following people up, ask the agent to turn the campaign into a journey, then publish it.',
         jsonb_build_object('campaignId', c."id", 'kind', 'sequence_retired', 'steps', jsonb_array_length(c."sequence_steps")),
         '/dashboard/journeys'
    FROM "outreach_campaigns" c
   WHERE c."enabled"
     AND jsonb_typeof(c."sequence_steps") = 'array'
     AND jsonb_array_length(c."sequence_steps") > 0
     AND NOT EXISTS (
       SELECT 1 FROM "journeys" j WHERE j."outreach_campaign_id" = c."id" AND j."status" <> 'archived'
     )
     AND NOT EXISTS (
       SELECT 1 FROM "org_alerts" a
        WHERE a."org_id" = c."org_id" AND a."source" = 'journeys' AND a."subject_id" = c."id" || ':sequence_retired'
     );
END $$;
