-- ============================================================================
-- Journeys module RLS policies.
-- Org-scoped, admin-only: journeys are built by admin agents over MCP and
-- published by signed-in operators; end-user audiences never read them.
-- ============================================================================

ALTER TABLE journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE journeys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON journeys;
CREATE POLICY tenant_isolation ON journeys
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

ALTER TABLE journey_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON journey_versions;
CREATE POLICY tenant_isolation ON journey_versions
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
