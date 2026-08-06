---
'@getmunin/dashboard-pages': patch
---

Send a freshly signed-up or signed-in owner straight to onboarding instead of routing them through the dashboard first.

`SignupForm` and `LoginForm` always pushed `/dashboard` (the `safeRedirect` fallback), and the need for onboarding was only discovered afterwards by `useDashboardGate` — two client-side API calls plus a route-bundle load later. The browser therefore sat on `/dashboard` for hundreds of milliseconds, and for seconds when the `/setup` route still had to be built, which read as "signup dropped me on the dashboard and a reload fixed it". Both forms now resolve the destination before navigating.

`resolvePostAuthDestination` falls back to `/dashboard` whenever the setup state can't be established (either read failing, no membership, a non-admin member), so `useDashboardGate` remains the backstop rather than being replaced. An explicit `?redirect=` target — invitations, deep links, the OAuth authorize resume — still wins over the setup check.
