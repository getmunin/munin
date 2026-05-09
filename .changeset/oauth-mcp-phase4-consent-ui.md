---
'@getmunin/dashboard-pages': minor
---

feat(oauth): branded consent UI at /dashboard/oauth/consent (Phase 4)

Custom consent page for the OAuth 2.1 authorization flow. Replaces Better-Auth's default `getConsentHTML` fallback with a Munin-styled card showing the client name, requested scopes, and Allow/Deny actions. Submission posts to `/auth/oauth2/consent` with `accept: true|false` and the `consent_code` from the query string; on success the user is redirected back to the OAuth client.

The page is added to `useDashboardGate`'s exempt list so a user can authorize an external app even before completing the built-in-AI setup wizard.

A wrapper at `apps/web/app/dashboard/oauth/consent/page.tsx` re-exports the component; cloud picks it up automatically when it bumps the package.
