-- skill://outreach/extract-call-outcome became skill://outreach/extract-outcome
-- when the pass grew to cover email and SMS replies, and its reserved custom-field
-- keys lost the "call" prefix with it. Every statement matches only the old names,
-- so re-running finds nothing left to do.
--
-- Both curator_jobs and crm_contacts are FORCE ROW LEVEL SECURITY, so every update
-- here needs app.bypass_rls. Without it these statements silently match no rows on a
-- real deploy while passing against a superuser connection, which is how a backfill
-- looks green in testing and does nothing in production.
DO $$
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);

  UPDATE curator_jobs
    SET job_uri = 'skill://outreach/extract-outcome'
    WHERE job_uri = 'skill://outreach/extract-call-outcome';

  UPDATE crm_contacts
    SET custom_fields =
      (custom_fields - 'callOutcome' - 'callOutcomeAt' - 'callOutcomeConversationId')
      || jsonb_strip_nulls(
           jsonb_build_object(
             'outreachOutcome', custom_fields -> 'callOutcome',
             'outreachOutcomeAt', custom_fields -> 'callOutcomeAt',
             'outreachOutcomeConversationId', custom_fields -> 'callOutcomeConversationId'
           )
         )
    WHERE custom_fields ?| ARRAY['callOutcome', 'callOutcomeAt', 'callOutcomeConversationId'];

  -- wrong_number only ever described a voice call; wrong_contact covers a reply from
  -- the wrong person too.
  UPDATE crm_contacts
    SET custom_fields = jsonb_set(custom_fields, '{outreachOutcome}', '"wrong_contact"')
    WHERE custom_fields ->> 'outreachOutcome' = 'wrong_number';

  PERFORM set_config('app.bypass_rls', 'off', true);
END $$;
