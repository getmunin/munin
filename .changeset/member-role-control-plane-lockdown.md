---
'@getmunin/core': patch
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
---

Deny the control plane to `member` sessions by default, and open the inbox back up explicitly.

The console has presented `member` as an inbox-only role since the oversight rebuild —
`OSS_CONSOLE_GROUPS` marks Overview, Automation, Review and Settings `adminOnly`,
`/dashboard` redirects members to `/dashboard/conversations`, and `SettingsShell`
bounces any non-admin. The backend never agreed. `RoleGuard` refuses `'member'` as a
gate on purpose ("all org members pass"), so the only closed routes were the ~20
carrying `@RequireRole('owner', 'admin')`. Everything else was open to a member with a
session cookie: `GET /v1/crm/export`, `/v1/kb/export`, `/v1/conv/export` (every message
body in the org), `/v1/cms/transfer/export`, `/v1/analytics/export/events`, their `POST
…/import` counterparts, the whole Review feed *including* its writes —
`kb/curation/candidates/{id}/publish`, `crm/merge-proposals/{id}/apply`,
`cms/drafts/{id}/approve` and `outreach/proposals/{id}/approve`, which is the human gate
that actually sends mail in the org's name — plus `/v1/curator/jobs` and its
claim/fail/progress endpoints, `/v1/inbox`, `/v1/overview/*`, `/v1/activity`,
`/v1/orgs/me`, `/v1/orgs/me/roster` and `/v1/skills`. UI-level hiding, no authorization.

Enumerating the closed set was the wrong shape: it is ~60 routes, it grows with every
new controller, and a controller added tomorrow joins the open side silently — which is
how this drifted in the first place. So the default is inverted instead.
`ControlPlaneGuard` — already on all 37 control-plane controllers, unlike `RoleGuard`,
which 21 of them never applied — now admits a user actor only when their role in the
active org is `owner` or `admin`, or when the route opts in with `@AllowMember()`. An
unrecognized future role starts closed rather than open. Refusals carry
`code: 'member_forbidden'` with an `errors.member_forbidden` entry in both locales,
since a member who types an admin URL will see it.

The member surface is now eleven routes, pinned by `member-surface.test.ts` so widening
it has to be a deliberate diff: the eight inbox routes the conversation pane actually
calls (`queue`, `{id}`, `messages`, `status`, `take-over`, `release`, `request-draft`,
`clear-draft`), `/v1/me/memberships` for role and org resolution, `/v1/overview/setup`
for the first-run copy, and `/v1/oauth/pending-org` so a member can still authorize a
connector — `gateOauthGrantsByRole` already assumed members complete that flow and just
lose `mcp:admin`.

Session credentials now carry the resolved membership role on `ActorIdentity.orgRole`,
so the common path costs no extra query. The guard falls back to reading `org_members`
when a credential arrives without one, which is what keeps a host that builds its own
session credentials — cloud — protected rather than locked out.

Two consequences worth naming. The console's queue badge came from `/v1/inbox`, which
mixes live conversations with the review feed and is now admin-only, so the shell reads
`/v1/conversations/queue` for non-admins instead and shows no review count; the badge
keeps working for members rather than silently sitting at zero. And the realtime
gateway is untouched: it authenticates its own WebSocket upgrade outside Nest guards, so
a member's socket still receives `kb.*` and `crm.merge_proposal.*` event notifications on
the org channel. Those carry ids and types rather than record bodies, and closing that
seam is follow-up work.
