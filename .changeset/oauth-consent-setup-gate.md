---
'@getmunin/dashboard-pages': minor
---

Route incomplete-setup users through onboarding before the OAuth consent page.

If an owner/admin with an unconfigured org (no provider API key, or empty org name) hit the OAuth authorize flow — e.g. adding the Munin MCP to an AI agent — they landed directly on `/dashboard/oauth/consent` and could grant access before completing onboarding. New accounts created during the OAuth flow already get routed through `/setup?<oauth_params>` from the signup form, then back to consent once `useSetupGate` clears; existing accounts with incomplete orgs skipped that step entirely because the consent page is exempted from `useDashboardGate`.

Adds a server-side gate (`redirectIfSetupIncomplete`) used by `apps/web/app/[locale]/dashboard/oauth/consent/page.tsx`. The Server Component forwards the session cookie to `/v1/agent-config` and `/v1/me/memberships`, and when setup is incomplete for an owner/admin it `redirect()`s to `/setup?<oauth_params>` before any consent HTML is sent. Once setup completes, `useSetupGate` already routes back to `/dashboard/oauth/consent?<oauth_params>`, so the consent UI shows on the next pass.
