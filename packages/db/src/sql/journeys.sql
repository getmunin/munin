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

ALTER TABLE journey_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_enrollments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON journey_enrollments;
CREATE POLICY tenant_isolation ON journey_enrollments
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

ALTER TABLE journey_step_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_step_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON journey_step_runs;
CREATE POLICY tenant_isolation ON journey_step_runs
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

ALTER TABLE journey_waits ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_waits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON journey_waits;
CREATE POLICY tenant_isolation ON journey_waits
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

-- Inbox: org-only, without the end-user clause, because JourneyEventSink
-- inserts from inside end-user self-service requests (crm_update_my_contact,
-- conv_request_human). The sink never reads it back there.
ALTER TABLE journey_event_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_event_inbox FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON journey_event_inbox;
CREATE POLICY tenant_isolation ON journey_event_inbox
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

ALTER TABLE journey_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON journey_templates;
CREATE POLICY tenant_isolation ON journey_templates
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

ALTER TABLE journey_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_approvals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON journey_approvals;
CREATE POLICY tenant_isolation ON journey_approvals
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

-- ───────────────────────── event sink check ─────────────────────────────────
-- The journey event sink runs inside every emitting transaction, end-user
-- requests included, and those cannot read `journeys`. It only needs to know
-- whether the caller's own org has a live or paused journey, so this answers
-- that one boolean for app_org_id() without exposing any row. Bypass is set
-- from the body and the caller's value put back, for the reasons spelled out
-- above conv_next_display_id in conv.sql.
CREATE OR REPLACE FUNCTION journeys_org_running() RETURNS boolean
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
  DECLARE
    v_caller_bypass text := COALESCE(current_setting('app.bypass_rls', true), 'off');
    v_running boolean;
  BEGIN
    PERFORM set_config('app.bypass_rls', 'on', true);
    SELECT EXISTS (
      SELECT 1 FROM journeys WHERE org_id = app_org_id() AND status IN ('live', 'paused')
    ) INTO v_running;
    PERFORM set_config('app.bypass_rls', v_caller_bypass, true);
    RETURN v_running;
  END;
  $$;
