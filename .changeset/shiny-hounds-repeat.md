---
'@getmunin/dashboard-pages': minor
'@getmunin/backend-core': minor
'@getmunin/types': minor
'@getmunin/core': minor
---

Scope a dashboard session's organization per request instead of per account

The active organization was a single account-wide flag (`org_members.is_default`) that every `/v1/*` request re-read, while the dashboard read the organization name once at page load and cached it. Switching organizations in one tab therefore changed what every other open tab was served, without changing what those tabs displayed — a stale label sitting on top of another organization's data. The same applied to a second browser or device, so no tab-local mechanism could have fixed it.

Session credentials now accept a requested organization. `CredentialResolver.resolveSessionToken` takes an optional organization id, checks it against the caller's memberships, and refuses with `OrgAccessDeniedError` when it isn't one — it never quietly serves a different organization instead. The control-plane guard reads that id from an `x-munin-org` request header on the session-cookie path only, so API keys and OAuth tokens stay bound to the organization they were issued for, and it maps the refusal to a `403` carrying `code: org_access_denied`. Every authenticated response now echoes the organization that served it in an `x-munin-org` response header (exposed through CORS), and the realtime websocket takes the same id as an `orgId` connect parameter.

On the client, the dashboard keeps its organization in `sessionStorage`, which is per-tab: a tab pins itself to whichever organization served its first response and stays there, so `is_default` now only decides where a *new* tab starts. `api()` sends the pin, adopts the served organization when it has none, and — if the pin is refused, which is what a user switching accounts in the same tab looks like — drops it and retries once, so recovery is invisible rather than a wall of errors.

This is the transport half of the fix. Until the organization also appears in the dashboard URL, server-rendered layouts still read `is_default`, so a tab pinned elsewhere can briefly render the account-wide organization name before the client corrects it.
