-- Self-service lookups (store orders, bookings, the caller's own CRM contact)
-- now trust an end user's email only when metadata.emailSource names an
-- allow-listed source ('org-attested', 'channel', 'legacy'). Before this, the
-- check was a deny-list ('visitor' or anonymous), so an email written by a
-- path that forgot to stamp itself was trusted by default.
--
-- Stamp every email that predates the allow-list so existing customers keep
-- their lookups:
--   * external_id 'email:…' rows were provisioned by inbound email or a
--     channel webhook -> 'channel'.
--   * every other unstamped email was trusted under the old rule -> 'legacy',
--     which the allow-list keeps trusting, so this changes no outcome.
-- Rows already stamped (including 'visitor') and anonymous rows' flags are
-- left alone.
--
-- end_users is FORCE RLS, so the bypass GUC is required even for the owner.
DO $$
BEGIN
  PERFORM set_config('app.bypass_rls', 'on', true);

  UPDATE end_users
  SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
    'emailSource',
    CASE WHEN external_id LIKE 'email:%' THEN 'channel' ELSE 'legacy' END
  )
  WHERE email IS NOT NULL
    AND btrim(email) <> ''
    AND (metadata IS NULL OR NOT (metadata ? 'emailSource'));
END $$;
