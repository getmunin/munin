---
'@getmunin/agent-host': patch
---

Add tenant-isolation RLS policies to `agent_config` and `agent_health` when they're built in **multi-tenant** mode (one row per org). Closes a defense-in-depth gap: in the multi-tenant variant, `id` references `orgs(id)` so each row holds an org's encrypted LLM provider API key, provider URL, and agent settings, but the table had no RLS policy. An app-DB query with the wrong `app.org_id` GUC could read another tenant's row (the encryption envelope still protects the key value itself, but everything else leaked).

The new policy uses the same `tenant_isolation` template as the rest of the schema: `id = app_org_id()` with an `app_bypass_rls()` short-circuit. `app_org_id()` / `app_bypass_rls()` are the helpers installed by `@getmunin/db`'s `rls.sql`, which `runMigrations` always applies before the agent-host DDL runs in cloud.

`AGENT_HOST_SINGLETON_DDL` and `AGENT_HEALTH_SINGLETON_DDL` (the OSS one-row variants) are **intentionally untouched** — RLS on a one-row, no-org-GUC table would just lock out the singleton fetch.

DDL is idempotent (`ALTER TABLE … ENABLE`, `DROP POLICY IF EXISTS`, `CREATE POLICY`) so re-applying on every cloud boot is safe.
