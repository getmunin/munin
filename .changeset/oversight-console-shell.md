---
'@getmunin/dashboard-pages': minor
---

Console shell: the dashboard grows a persistent 280px sidebar on tablet and up, and a
full-screen navigation sheet behind a single glyph on phones. Nav lives in a
`console-groups` registry that host apps extend the same way `settings-groups` is
extended, and every entry is role-gated by omission — a member sees no Admin group at
all rather than a disabled one.

Two supporting changes: the sidebar takes an injected slot next to the mark, so a host
app can put its own organization switcher there, and `/dashboard/settings` is now a real
grouped index page instead of a redirect to Team, which gives phones a settings list to
navigate from.
