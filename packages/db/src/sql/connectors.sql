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

-- Signing keys: one ES256 keypair per org for outbound custom-MCP identity
-- assertions. Rows are minted lazily by the service layer under bypass_rls
-- (the agent runner holds a service-role connection, not a request context),
-- and the public JWKS endpoint also reads under bypass_rls — it must serve
-- the public key without authentication so customer MCP servers can verify
-- assertion signatures. In-request reads stay org-scoped; the WITH CHECK
-- clause rejects any actor carrying an end-user identity so a self-service
-- session can never rotate or plant a key. The private key is
-- pgcrypto-encrypted PKCS8; only the service layer ever decrypts it.
ALTER TABLE connector_signing_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_signing_keys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON connector_signing_keys;
CREATE POLICY tenant_isolation ON connector_signing_keys
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  );
