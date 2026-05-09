---
'@getmunin/dashboard-pages': major
---

refactor!: route alignment + ai-agent → builtin-ai rename + setup gate

Frontend route alignment, the second pass after the API rename. Three things in one diff:

**1. Rename `/dashboard/settings/ai-agent` → `/dashboard/settings/builtin-ai`** in OSS and updates the wizard's hardcoded internal link. The package export `AgentSettingsPage` is renamed to `BuiltinAiSettingsPage` to match the URL.

**2. New gate hooks** for use in dashboard layouts and the setup page:

- `useDashboardGate()` — returns `{ ready, role }`. When the active org's built-in AI is not configured (`providerApiKeySet === false`) and the user is owner/admin, redirects to `/setup`. Members are allowed through (they see the dashboard's per-page empty states). `/dashboard/account` is exempt — escape hatch if onboarding goes sideways.
- `useSetupGate()` — returns `{ ready }`. Inverse: redirects to `/dashboard` when configuration is already complete.
- `useAgentConfigStatus()` — small primitive used by both gate hooks.

**3. OSS app wired up.** `apps/web/app/dashboard/layout.tsx` now uses `useDashboardGate`; `apps/web/app/setup/page.tsx` now uses `useSetupGate`.

Companion frontend changes ship in `munin-cloud` once a release of this package is published.
