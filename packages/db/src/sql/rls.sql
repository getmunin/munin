-- ============================================================================
-- Munin RLS policies (dual-scope: org_id always, end_user_id when delegated).
-- Applied during migrations (M0.3) by the migrate runner, after Drizzle's
-- schema migration.
--
-- Defense-in-depth: app-layer Drizzle queries also filter by org_id and (when
-- relevant) end_user_id; these policies are the second line of defense.
--
-- Activation pattern (NestJS TenancyInterceptor, per request):
--   BEGIN;
--     SELECT set_config('app.org_id',      '<org_xxx>', true);
--     SELECT set_config('app.end_user_id', '<eu_xxx>',  true);  -- delegated only
--     ... query ...
--   COMMIT;
--
-- Critical Scaleway/Neon-pooler note: pooler is transaction-mode, so the
-- third arg `true` (transaction-local) is required.
--
-- This file is idempotent — every CREATE OR REPLACE / DROP IF EXISTS — so
-- re-running it on an upgrade does not error.
-- ============================================================================

-- ───────────────────────── helper functions ────────────────────────────────

CREATE OR REPLACE FUNCTION app_org_id() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT COALESCE(current_setting('app.org_id', true), ''); $$;

CREATE OR REPLACE FUNCTION app_end_user_id() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT COALESCE(current_setting('app.end_user_id', true), ''); $$;

CREATE OR REPLACE FUNCTION app_bypass_rls() RETURNS bool
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT COALESCE(current_setting('app.bypass_rls', true), 'off') = 'on'; $$;

-- ───────────────────────── policy template ─────────────────────────────────
--
-- For org-scoped tables: tenant_isolation policy
--   - allow when bypass_rls is on (admin / migration / job)
--   - else require org_id matches the GUC
--
-- For tables that ALSO carry end_user_id (e.g. tokens, future tickets/messages):
--   tenant_and_end_user_isolation policy
--   - same as above, plus when app_end_user_id is non-empty,
--     require end_user_id matches
--
-- We re-create policies after dropping any existing ones with the same name
-- so this script is idempotent across upgrades.
-- ───────────────────────────────────────────────────────────────────────────

-- ───────────────────────── orgs ────────────────────────────────────────────
ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE orgs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON orgs;
CREATE POLICY tenant_isolation ON orgs
  USING (app_bypass_rls() OR id = app_org_id())
  WITH CHECK (app_bypass_rls() OR id = app_org_id());

-- ───────────────────────── end_users ───────────────────────────────────────
ALTER TABLE end_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE end_users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON end_users;
CREATE POLICY tenant_isolation ON end_users
  USING (
    app_bypass_rls()
    OR (
      org_id = app_org_id()
      AND (app_end_user_id() = '' OR id = app_end_user_id())
    )
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

-- ───────────────────────── agents ──────────────────────────────────────────
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON agents;
CREATE POLICY tenant_isolation ON agents
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

-- ───────────────────────── oauth_clients ───────────────────────────────────
-- oauth_clients can be either org-scoped (after consent links them) or
-- nullable-org (during pre-consent registration). Allow null org reads
-- only with bypass; otherwise require match.
ALTER TABLE oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_clients FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON oauth_clients;
CREATE POLICY tenant_isolation ON oauth_clients
  USING (app_bypass_rls() OR (org_id IS NOT NULL AND org_id = app_org_id()))
  WITH CHECK (app_bypass_rls() OR (org_id IS NOT NULL AND org_id = app_org_id()));

-- ───────────────────────── tokens ──────────────────────────────────────────
-- Tokens carry both org_id and (sometimes) end_user_id. End-user agents can
-- only see their own token row.
ALTER TABLE tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tokens;
CREATE POLICY tenant_isolation ON tokens
  USING (
    app_bypass_rls()
    OR (
      org_id = app_org_id()
      AND (app_end_user_id() = '' OR end_user_id = app_end_user_id())
    )
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

-- ───────────────────────── api_keys ────────────────────────────────────────
-- Admin API keys are org-scoped: visible to the org they belong to.
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON api_keys;
CREATE POLICY tenant_isolation ON api_keys
  USING (app_bypass_rls() OR (org_id IS NOT NULL AND org_id = app_org_id()))
  WITH CHECK (app_bypass_rls() OR (org_id IS NOT NULL AND org_id = app_org_id()));

-- ───────────────────────── audit_log ───────────────────────────────────────
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON audit_log;
CREATE POLICY tenant_isolation ON audit_log
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

-- ───────────────────────── events ──────────────────────────────────────────
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON events;
CREATE POLICY tenant_isolation ON events
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

-- ───────────────────────── claims ──────────────────────────────────────────
ALTER TABLE claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON claims;
CREATE POLICY tenant_isolation ON claims
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

-- ───────────────────────── webhooks ────────────────────────────────────────
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON webhooks;
CREATE POLICY tenant_isolation ON webhooks
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

-- ───────────────────────── webhook_deliveries ──────────────────────────────
-- No org_id column; constrained transitively via webhook_id.
-- We use a sub-select policy so deliveries inherit their webhook's tenancy.
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON webhook_deliveries;
CREATE POLICY tenant_isolation ON webhook_deliveries
  USING (
    app_bypass_rls()
    OR EXISTS (
      SELECT 1 FROM webhooks w
      WHERE w.id = webhook_deliveries.webhook_id
        AND w.org_id = app_org_id()
    )
  );

-- ───────────────────────── bootstrap_state ─────────────────────────────────
ALTER TABLE bootstrap_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE bootstrap_state FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON bootstrap_state;
CREATE POLICY tenant_isolation ON bootstrap_state
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

-- ───────────────────────── suggestions / votes ─────────────────────────────
-- Suggestions are dual-mode: org-private rows visible only to that org;
-- public rows visible across orgs (read-only). Bypass always passes.
ALTER TABLE suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE suggestions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON suggestions;
CREATE POLICY tenant_isolation ON suggestions
  USING (
    app_bypass_rls()
    OR org_id = app_org_id()
    OR public = true
  )
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

ALTER TABLE votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON votes;
CREATE POLICY tenant_isolation ON votes
  USING (
    app_bypass_rls()
    OR EXISTS (
      SELECT 1 FROM suggestions s
      WHERE s.id = votes.suggestion_id
        AND (s.org_id = app_org_id() OR s.public = true)
    )
  );

-- ───────────────────────── rate_limit_counters ─────────────────────────────
ALTER TABLE rate_limit_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_counters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rate_limit_counters;
CREATE POLICY tenant_isolation ON rate_limit_counters
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

-- ───────────────────────── org_invitations ─────────────────────────────────
-- Members-management surface; org-scoped, admin-only. The accept-invite
-- endpoint reads via service-role bypass since the invitee isn't yet a
-- member of the target org and can't satisfy the GUC.
ALTER TABLE org_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_invitations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON org_invitations;
CREATE POLICY tenant_isolation ON org_invitations
  USING (app_bypass_rls() OR org_id = app_org_id())
  WITH CHECK (app_bypass_rls() OR org_id = app_org_id());

-- ───────────────────────── tables intentionally WITHOUT RLS ────────────────
-- These are accessed only by the service role / migrations:
--   users          (BetterAuth-managed; tenant scoping via org_members)
--   org_members    (composite key already enforces tenancy)
