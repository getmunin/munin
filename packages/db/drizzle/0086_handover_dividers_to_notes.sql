-- requestHandover now records its reason as an internal agent note
-- (metadata.kind = 'internal_note') instead of a system message, so the
-- dashboard renders it as a note card rather than a centered divider. Existing
-- rows carry the old shape:
--   • "draft reply ready for review" dividers were posted once per parked draft
--     and duplicate what the pending-draft badge and the seeded composer already
--     show, so they are deleted outright.
--   • dividers carrying a real handover reason are converted to the new note
--     shape so the reason stays in the thread.
-- Every statement matches only author_type = 'system', which the code no longer
-- writes for handovers, so re-running finds nothing left to do.
--
-- conv_messages is FORCE ROW LEVEL SECURITY; without app.bypass_rls these
-- statements silently match no rows on a real deploy while passing against a
-- superuser connection.
DO $$
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);

  DELETE FROM conv_messages
    WHERE author_type = 'system'
      AND internal
      AND body = 'Agent requested handover: draft reply ready for review';

  UPDATE conv_messages
    SET author_type = 'agent',
        metadata = COALESCE(metadata, '{}'::jsonb) || '{"kind": "internal_note"}'::jsonb
    WHERE author_type = 'system'
      AND internal
      AND body LIKE 'Agent requested handover%';

  PERFORM set_config('app.bypass_rls', 'off', true);
END $$;
