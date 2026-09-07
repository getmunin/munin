---
'@getmunin/dashboard-pages': minor
---

The Oversight console shell replaces the topbar dashboard chrome. All `/dashboard/*` routes now render inside a 280px bone sidebar: a plain brand head (consumers can inject extra head content via `headSlot`) and role-gated nav groups (Admin / Workspace for now — Oversight destinations land with their own releases) with live badges fed by `/v1/inbox`. On phones the sidebar becomes a 56px header whose ☰ opens a full-screen role-gated menu sheet with a sign-out foot, per the mobile design. `DashboardShell` keeps its public props and delegates to the new `ConsoleShell`; settings routes keep their own chrome. The old `DashboardTopbar`/`SettingsTopbar` exports are removed. `nav/console-groups.ts` mirrors the settings-groups pattern (`consoleGroupsForRole`, `extendConsoleGroups`, exact-match active state for the dashboard root).
