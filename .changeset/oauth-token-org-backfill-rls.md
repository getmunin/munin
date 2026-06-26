---
'@getmunin/db': patch
---

fix(db): backfill OAuth token reference_id under bypass_rls

Migration `0045` backfilled `oauth_refresh_token.reference_id` (and access tokens) by joining `org_members`, but that table has `FORCE ROW LEVEL SECURITY`. Real deploys run migrations as the database **owner** (Scaleway RDB has no Postgres superuser), and `FORCE` RLS applies to the owner — so without `app.bypass_rls` set, the `org_members` join saw zero rows and the backfill silently updated nothing, leaving every existing OAuth agent unpinned and hidden from the flock. (It only appeared to work in tests, which run as a superuser that bypasses RLS.)

`0046` re-runs the backfill inside a `DO` block that sets `app.bypass_rls` first, so it works under the owner role too.
