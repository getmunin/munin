---
'@getmunin/dashboard-pages': minor
---

The Oversight console shell replaces the topbar dashboard chrome. All `/dashboard/*` routes now render inside a 280px bone sidebar: logo + org switcher head (memberships-driven, reload on switch), role-gated nav groups (Admin / Workspace for now — Oversight destinations land with their own releases) with live badges fed by `/v1/inbox`, and an "On duty now" foot card reading the new roster endpoint with per-member claim counts. On phones the sidebar becomes a 56px header whose ☰ opens a full-screen role-gated menu sheet with a sign-out foot, per the mobile design. `DashboardShell` keeps its public props and delegates to the new `ConsoleShell`; settings routes keep their own chrome. `nav/console-groups.ts` mirrors the settings-groups pattern (`consoleGroupsForRole`, `extendConsoleGroups`, exact-match active state for the dashboard root).
