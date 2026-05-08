---
'@getmunin/agent-host': patch
---

fix(agent-host): inline DEFAULT literals in singleton DDL

The drizzle `sql` template was interpolating two string constants
(`DEFAULT_CHAT_MODEL`, `DEFAULT_PROVIDER_BASE_URL`) as parameters
($1, $2). Postgres rejects parameter binding in `DEFAULT` clauses
on `CREATE TABLE` with syntax error 42601, so `pnpm --filter
@getmunin/backend migrate` failed on a fresh database. Inline the
literal values directly into the SQL.

Multi-tenant DDL was unaffected (no DEFAULTs).
