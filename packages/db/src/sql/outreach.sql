-- ============================================================================
-- Munin Outreach RLS policies. Applied during migrations after schema.
-- ============================================================================

-- Campaigns: org-scoped, admin-only. Self-service tokens never see
-- campaigns (operator-internal targeting + brief).
ALTER TABLE outreach_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_campaigns FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON outreach_campaigns;
CREATE POLICY tenant_isolation ON outreach_campaigns
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

-- Proposals: org-scoped, admin-only. The curator (admin actor) writes;
-- the operator review flow reads/decides via dashboard.
ALTER TABLE outreach_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_proposals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON outreach_proposals;
CREATE POLICY tenant_isolation ON outreach_proposals
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

-- Email templates: org-scoped, admin-only. Operator-authored layout; end-user
-- audiences have no reason to read it.
ALTER TABLE outreach_email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_email_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON outreach_email_templates;
CREATE POLICY tenant_isolation ON outreach_email_templates
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

-- Broadcasts and their recipients: org-scoped, admin-only. Recipient rows
-- carry addresses and send outcomes; end-user audiences never see them.
ALTER TABLE outreach_broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_broadcasts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON outreach_broadcasts;
CREATE POLICY tenant_isolation ON outreach_broadcasts
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

ALTER TABLE outreach_broadcast_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_broadcast_recipients FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON outreach_broadcast_recipients;
CREATE POLICY tenant_isolation ON outreach_broadcast_recipients
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
