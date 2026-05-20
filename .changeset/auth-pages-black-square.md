---
'@getmunin/dashboard-pages': minor
---

Update auth-page styling: primary action (Sign in / Continue) is now black (`bg-ink`) with cobalt-deep on hover, matching the rest of the dashboard's primary buttons. Inputs and buttons are now square (12px corner radius removed) on auth and invite acceptance pages. The `variant="navy"` prop name on `AuthSubmit` is kept for backwards compatibility but no longer uses the navy color token.
