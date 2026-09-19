---
'@getmunin/dashboard-pages': minor
'@getmunin/backend-core': minor
'@getmunin/types': minor
'@getmunin/core': patch
---

Point Slack links at the item the card is about, in the org it belongs to

Every link a Slack card carried went to `/dashboard`, leaving the operator to
find the thing the message was already describing. A conversation card now opens
that conversation, an approval card opens that item in the review queue (the
queue's item id is the subject id, so the card's own subject addresses it), and a
grouped parent — outreach campaign, CMS locale set, social variant set — opens
the review queue, because the group is the several items under it.

A bare `/dashboard` link was also ambiguous wherever one deployment hosts several
organizations: `slack_integrations.team_id` is deliberately not unique because one
Slack workspace may serve several orgs, and inbound routing already resolves by
channel. Outbound had no such qualifier, so a teammate who belongs to more than one
org landed in whichever org their browser session last had active and found no such
item.

Such deployments can now scope dashboard routes as `/o/<orgId>/dashboard/...` — the
same `/o/<orgId>` grammar the MCP connector pin uses — by mounting the route tree
under an `[orgId]` segment, passing `orgScopedRoutes: true` to `withSetupGate`, and
calling `registerOrgScopedDashboard(true)` at backend composition. A single-org
deployment does none of that and is unchanged: its URLs stay `/dashboard/...` and no
setting is exposed for an operator to find or get wrong.

Where the org segment is in play, it is injected in the navigation layer, so links
written as `/dashboard/...` throughout the dashboard keep working and resolve against
the org whose route is open. Server-rendered bootstrap reads carry the org header, so
a multi-org operator's first paint is the org they followed the link into, and
membership lookups deliberately skip that header so "which orgs am I in" still answers
when the current org denies you. Opening a link for an org you are not a member of now
says so and offers one you do belong to, instead of quietly showing you a different
workspace's data. Legacy `/dashboard/*` links redirect to the viewer's default org,
keeping the rest of the path.

Following any dashboard link while signed out now returns to that exact destination
after sign-in instead of dropping you on the overview.

Alert emails also carry a followable link: the CTA on a system-alert email was
the stored relative path (`/dashboard/settings/privacy`), which is dead in a
mail client. It is now absolute, and scoped to the alerting org where routes are
org-scoped. The two copies
of `readWebBaseUrl` are consolidated into `common/web-url.ts` rather than a
third being added, and three outreach skills that still pointed at
`/dashboard/inbox` — a route that no longer exists — now point at
`/dashboard/review`.
