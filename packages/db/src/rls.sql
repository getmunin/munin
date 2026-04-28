-- ============================================================================
-- Munin RLS policies (dual-scope: org_id always, end_user_id when delegated).
-- Applied during migrations (M0.3) by the migrate runner.
--
-- Defense-in-depth: app-layer Drizzle queries also filter by org_id and (when
-- relevant) end_user_id; these policies are the second line of defense.
--
-- Activation pattern in NestJS request interceptor:
--   BEGIN;
--     SET LOCAL app.org_id = '<org_xxx>';
--     SET LOCAL app.end_user_id = '<eu_xxx>'; -- only for delegated tokens
--     ... query ...
--   COMMIT;
--
-- Critical Scaleway/Neon-pooler note: pooler is transaction-mode, so SET LOCAL
-- works inside an explicit transaction. Plain SET (session-scoped) does not.
-- ============================================================================

-- Helper: read GUCs as text, defaulting to empty string when unset.
CREATE OR REPLACE FUNCTION app_org_id() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT COALESCE(current_setting('app.org_id', true), ''); $$;

CREATE OR REPLACE FUNCTION app_end_user_id() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT COALESCE(current_setting('app.end_user_id', true), ''); $$;

-- Service role bypass: when running migrations / admin jobs we set
-- app.bypass_rls = 'on' on a dedicated connection that does not go through
-- the tenancy interceptor.
CREATE OR REPLACE FUNCTION app_bypass_rls() RETURNS bool
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT COALESCE(current_setting('app.bypass_rls', true), 'off') = 'on'; $$;

-- ───────────────────────── Tables to be implemented in M0.3 ─────────────────
-- The full ALTER TABLE … ENABLE ROW LEVEL SECURITY + CREATE POLICY statements
-- land in the next migration once the tenancy interceptor is wired and we have
-- end-to-end tests proving cross-org isolation.
--
-- Tables that get RLS:
--   orgs, end_users, agents, oauth_clients, tokens, api_keys, audit_log,
--   events, claims, webhooks, webhook_deliveries, bootstrap_state,
--   suggestions, votes, rate_limit_counters
--
-- Tables that DO NOT get RLS (cross-org by design):
--   users (BetterAuth-managed, scoped via org_members instead)
--   partners (admin-only resource, accessed via partner key)
--   org_members (composite key already enforces tenancy)
