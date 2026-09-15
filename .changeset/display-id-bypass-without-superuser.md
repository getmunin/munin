---
'@getmunin/db': patch
---

Set the RLS bypass from inside `conv_next_display_id` instead of attaching it to the function, so a non-superuser migration role can create it.

5.25.0 gave the allocator a `SET app.bypass_rls = 'on'` function attribute, which is the right behaviour and the wrong mechanism. `app.bypass_rls` is a custom placeholder GUC that no extension defines, so `CREATE FUNCTION ... SET` runs it through `pg_parameter_aclcheck`, and a role without `GRANT SET ON PARAMETER` is refused with `permission denied to set parameter "app.bypass_rls"`. That GRANT can only be issued by a superuser. The migration therefore failed outright on exactly the managed Postgres the attribute was added for — Scaleway's `munin_admin` is an admin role, not a Postgres superuser, and the database is owned by `_rdb_superadmin`. Local and CI databases migrate as a real superuser, which is why nothing caught it before a deploy did.

The function is plpgsql now: it reads the caller's `app.bypass_rls`, turns it on with `set_config(..., true)`, takes the `MAX(display_id)` over the whole org, and puts the caller's own value back before returning. `set_config` at run time has no privilege check — it is how the application sets these GUCs on every request — and an error between the two aborts the (sub)transaction, which rolls the setting back anyway. The advisory lock, the org-wide count under end-user-delegated RLS, and the untouched caller context after the call are all unchanged and still asserted; a new test pins `proconfig` to nothing under `app.`, since that is the part a superuser-backed CI run cannot fail on.
