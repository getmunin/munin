-- ============================================================================
-- Munin Connectors RLS policies. Applied during migrations after schema.
-- ============================================================================

-- Connections: org-scoped credentials for third-party systems (commerce,
-- bookings, …). Reads are allowed for end-user actors because the
-- self-service lookup tools (commerce_get_my_orders, bookings_get_my_reservations)
-- must load the connection config to call the vendor API on the end-user's behalf. Secrets inside `config` are
-- pgcrypto-encrypted and the MCP tools never return config fields to
-- self-service callers. Writes are admin-only: the WITH CHECK clause rejects
-- any actor carrying an end-user identity.
ALTER TABLE connector_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_connections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON connector_connections;
CREATE POLICY tenant_isolation ON connector_connections
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  );

-- Credential requests: one-time credential-handoff links. Minted by admins
-- (WITH CHECK rejects end-user actors); the public completion path resolves
-- and completes them under app_bypass_rls on a service-role connection.
ALTER TABLE credential_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE credential_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON credential_requests;
CREATE POLICY tenant_isolation ON credential_requests
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  );
