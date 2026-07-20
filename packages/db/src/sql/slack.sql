-- ============================================================================
-- Slack operator-bridge module RLS policies.
-- Org-scoped operator surface. Most tables additionally require an empty
-- end-user GUC (delegated end-user contexts must not see them). Exceptions:
-- slack_integrations and slack_deliveries, which the event sink touches
-- inside *any* request that emits a conversation event — including widget
-- requests running with app.end_user_id set — so those two are org-only.
-- The bridge worker and the public OAuth callback use the service-role
-- connection (bypass_rls).
-- ============================================================================

ALTER TABLE slack_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE slack_integrations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON slack_integrations;
CREATE POLICY tenant_isolation ON slack_integrations
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

ALTER TABLE slack_channel_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE slack_channel_routes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON slack_channel_routes;
CREATE POLICY tenant_isolation ON slack_channel_routes
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

ALTER TABLE slack_conversation_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE slack_conversation_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON slack_conversation_links;
CREATE POLICY tenant_isolation ON slack_conversation_links
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

ALTER TABLE slack_message_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE slack_message_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON slack_message_links;
CREATE POLICY tenant_isolation ON slack_message_links
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

ALTER TABLE slack_user_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE slack_user_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON slack_user_links;
CREATE POLICY tenant_isolation ON slack_user_links
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

ALTER TABLE slack_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE slack_deliveries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON slack_deliveries;
CREATE POLICY tenant_isolation ON slack_deliveries
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
