---
'@getmunin/db': patch
'@getmunin/core': patch
'@getmunin/backend': patch
---

**Security**: enable RLS on `org_members`.

`org_members` was the last org-scoped table without a tenant-isolation policy.
The composite `(org_id, user_id)` primary key meant correct controllers couldn't
return cross-org rows by accident, but the database stopped catching mistakes —
any future controller that forgot the WHERE clause would leak membership info
across tenants. The meta-test in `rls.test.ts` was suppressed with an
exemption.

This patch:

- Adds a `tenant_isolation` policy on `org_members` mirroring the other
  org-scoped tables (`org_id = app_org_id() OR app_bypass_rls()`).
- Wraps the three structurally cross-org reads (OAuth credential resolver,
  JWT credential resolver, session credential resolver, signup) in a
  `bypass_rls` transaction — they filter by `user_id` and run before
  `TenancyInterceptor` sets `app.org_id`, so they could not satisfy a strict
  policy. Introduces a shared `readMembershipsForUser` helper in
  `@getmunin/core` so the three sites stay consistent.
- Drops the `org_members` exemption from the "every org_id table has RLS"
  meta-test.

Migrations are idempotent and re-apply `rls.sql` on each run, so existing
deployments pick up the policy on next migrate.
