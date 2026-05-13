-- ============================================================================
-- Munin conv-channel extras: RLS policies for outbound delivery state and
-- generic inbound poll state. Applied during migrations after Drizzle
-- schema and the conversations module's RLS.
--
-- The pgcrypto extension (used for at-rest encryption of channel SMTP/IMAP
-- credentials) is enabled by `runMigrations` alongside vector / pg_trgm /
-- citext, so no CREATE EXTENSION here.
-- ============================================================================

-- Outbound deliveries: org-scoped, admin-only. End-user audience never
-- sees per-message delivery internals. The worker runs with
-- app.bypass_rls=on (transaction-locally) so the policy still applies for
-- request-context callers (the dashboard "queued / sent / failed" view).
ALTER TABLE conv_message_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE conv_message_deliveries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON conv_message_deliveries;
CREATE POLICY tenant_isolation ON conv_message_deliveries
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

-- Inbound poll bookkeeping carries no org_id of its own; RLS inherits from
-- the parent channel via a sub-select. Mirrors the webhook_deliveries
-- pattern in rls.sql.
ALTER TABLE conv_inbound_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE conv_inbound_state FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON conv_inbound_state;
CREATE POLICY tenant_isolation ON conv_inbound_state
  USING (
    app_bypass_rls()
    OR EXISTS (
      SELECT 1 FROM conv_channels c
      WHERE c.id = conv_inbound_state.channel_id
        AND c.org_id = app_org_id()
        AND app_end_user_id() = ''
    )
  )
  WITH CHECK (
    app_bypass_rls()
    OR EXISTS (
      SELECT 1 FROM conv_channels c
      WHERE c.id = conv_inbound_state.channel_id
        AND c.org_id = app_org_id()
    )
  );

-- Per-end-user read stamps on agent messages. Org-scoped, admin reads
-- everything for "Seen at …" dashboard badges. The widget ingest service
-- runs with app.bypass_rls=on (it writes on behalf of the end-user but
-- needs to write the org_id too), so the WITH CHECK gate stays the
-- standard one.
ALTER TABLE conv_message_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE conv_message_reads FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON conv_message_reads;
CREATE POLICY tenant_isolation ON conv_message_reads
  USING (
    app_bypass_rls()
    OR (org_id = app_org_id() AND app_end_user_id() = '')
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());
