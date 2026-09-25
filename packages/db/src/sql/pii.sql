-- ============================================================================
-- PII span store RLS policies.
--
-- Org-scoped and admin-only. An end user has no business reading which names
-- were detected in the org's inbox, so delegated end-user sessions are excluded
-- even when the org matches.
--
-- The annotation worker never connects to Postgres. Its claim and submit calls
-- land in the backend, which finds orgs with pending work under app.bypass_rls
-- and then reads and writes each org's rows under that org's tenancy GUCs.
-- ============================================================================

ALTER TABLE pii_message_annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE pii_message_annotations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pii_message_annotations;
CREATE POLICY tenant_isolation ON pii_message_annotations
  USING (app_bypass_rls() OR (org_id = app_org_id() AND app_end_user_id() = ''))
  WITH CHECK (app_bypass_rls() OR (org_id = app_org_id() AND app_end_user_id() = ''));

ALTER TABLE pii_spans ENABLE ROW LEVEL SECURITY;
ALTER TABLE pii_spans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pii_spans;
CREATE POLICY tenant_isolation ON pii_spans
  USING (app_bypass_rls() OR (org_id = app_org_id() AND app_end_user_id() = ''))
  WITH CHECK (app_bypass_rls() OR (org_id = app_org_id() AND app_end_user_id() = ''));
