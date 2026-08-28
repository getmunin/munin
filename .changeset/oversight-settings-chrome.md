---
'@getmunin/dashboard-pages': minor
---

Settings opens for support agents. The settings shell no longer bounces non-admins back to the dashboard: agents see Workspace → Account plus the "Workspace, access, and monitoring are admin-only" note, and landing on any other settings page redirects them to Account. The back link in the settings topbar is role-labelled and role-targeted — "Back to overview" → `/dashboard` for admins, "Back to conversations" → the review queue for agents — matching the console's role-based landing. `settingsGroupsForRole` joins the exported nav-data helpers so downstream shells can apply the same gating.
