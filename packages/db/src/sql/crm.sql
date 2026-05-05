-- ============================================================================
-- Munin CRM RLS policies. Applied during migrations after schema.
-- ============================================================================

-- Companies: org-scoped, admin-only. Self-service callers don't see
-- companies in v0.4 (their CRM surface is "my contact" + "log activity").
ALTER TABLE crm_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_companies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON crm_companies;
CREATE POLICY tenant_isolation ON crm_companies
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

-- Contacts: org-scoped + dual-scope on end_user_id. Self-service tokens
-- only see the contact whose end_user_id matches the GUC.
ALTER TABLE crm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_contacts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON crm_contacts;
CREATE POLICY tenant_isolation ON crm_contacts
  USING (
    app_bypass_rls()
    OR (
      org_id = app_org_id()
      AND (app_end_user_id() = '' OR end_user_id = app_end_user_id())
    )
  )
  WITH CHECK (
    app_bypass_rls()
    OR (
      org_id = app_org_id()
      AND (app_end_user_id() = '' OR end_user_id = app_end_user_id())
    )
  );

-- Pipelines / stages / deals: org-scoped, admin-only.
ALTER TABLE crm_pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_pipelines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON crm_pipelines;
CREATE POLICY tenant_isolation ON crm_pipelines
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

ALTER TABLE crm_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_stages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON crm_stages;
CREATE POLICY tenant_isolation ON crm_stages
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

ALTER TABLE crm_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_deals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON crm_deals;
CREATE POLICY tenant_isolation ON crm_deals
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

-- Activities: dual-scope. Self-service callers only see activities they
-- generated (end_user_id matches), so a voice agent can read its own
-- "spoke for 4m" entries but not the human's internal notes about them.
ALTER TABLE crm_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_activities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON crm_activities;
CREATE POLICY tenant_isolation ON crm_activities
  USING (
    app_bypass_rls()
    OR (
      org_id = app_org_id()
      AND (app_end_user_id() = '' OR end_user_id = app_end_user_id())
    )
  )
  WITH CHECK (
    app_bypass_rls()
    OR (
      org_id = app_org_id()
      AND (app_end_user_id() = '' OR end_user_id = app_end_user_id())
    )
  );

-- Relationships: org-scoped, admin-only.
ALTER TABLE crm_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_relationships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON crm_relationships;
CREATE POLICY tenant_isolation ON crm_relationships
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

-- Merge proposals: org-scoped, admin-only. Self-service tokens never see
-- proposals (the curator is an admin actor, the operator review flow is
-- admin/dashboard).
ALTER TABLE crm_merge_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_merge_proposals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON crm_merge_proposals;
CREATE POLICY tenant_isolation ON crm_merge_proposals
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

-- Segments: org-scoped, admin-only. Self-service tokens never see segments
-- (segment definitions can encode operator-internal targeting logic).
ALTER TABLE crm_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_segments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON crm_segments;
CREATE POLICY tenant_isolation ON crm_segments
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
