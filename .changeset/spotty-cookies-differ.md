---
'@getmunin/backend-core': minor
---

Add `MUNIN_AUTH_COOKIE_PREFIX` (and a `cookiePrefix` option on `createMuninAuthCore`) to namespace BetterAuth session cookies per environment. Set a distinct prefix on deployments that share a registrable domain (e.g. apex prod + dev subdomain) so the prod apex-domain cookie no longer shadows the dev session cookie under the same name and breaks sign-in. The auth guard, realtime gateway, and invitation-accept cookie parsers all derive their accepted cookie names from the same prefix.
