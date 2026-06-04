-- ============================================================================
-- Analytics module RLS policies.
-- Org-scoped, admin-only. Write path is the public ingest endpoint, which
-- uses the service-role DB and bypasses RLS; reads are admin-side only.
-- ============================================================================

ALTER TABLE analytics_view_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_view_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON analytics_view_events;
CREATE POLICY tenant_isolation ON analytics_view_events
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

ALTER TABLE analytics_search_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_search_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON analytics_search_events;
CREATE POLICY tenant_isolation ON analytics_search_events
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
