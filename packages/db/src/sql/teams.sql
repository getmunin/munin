-- ============================================================================
-- Microsoft Teams operator-bridge module RLS policies.
-- Same shape as slack.sql: org-scoped operator surface, and most tables also
-- require an empty end-user GUC so delegated end-user contexts cannot see them.
-- teams_integrations and teams_deliveries are org-only because the event sink
-- touches them inside *any* request that emits a conversation event, widget
-- requests with app.end_user_id set included. The bridge worker, the public
-- messaging endpoint and the credential handoff use bypass_rls.
-- ============================================================================

ALTER TABLE teams_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams_integrations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON teams_integrations;
CREATE POLICY tenant_isolation ON teams_integrations
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

ALTER TABLE teams_installed_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams_installed_teams FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON teams_installed_teams;
CREATE POLICY tenant_isolation ON teams_installed_teams
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

ALTER TABLE teams_channel_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams_channel_routes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON teams_channel_routes;
CREATE POLICY tenant_isolation ON teams_channel_routes
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

ALTER TABLE teams_conversation_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams_conversation_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON teams_conversation_links;
CREATE POLICY tenant_isolation ON teams_conversation_links
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

ALTER TABLE teams_message_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams_message_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON teams_message_links;
CREATE POLICY tenant_isolation ON teams_message_links
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

ALTER TABLE teams_user_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams_user_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON teams_user_links;
CREATE POLICY tenant_isolation ON teams_user_links
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

ALTER TABLE teams_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams_deliveries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON teams_deliveries;
CREATE POLICY tenant_isolation ON teams_deliveries
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
