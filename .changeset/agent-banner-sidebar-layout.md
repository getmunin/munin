---
'@getmunin/dashboard-pages': patch
---

Stop the agent-health banner from pushing the settings-page Sign out button below the viewport. The banner now sticks to viewport top alongside the topbar, has a fixed `h-12` (with `truncate` on the message so long provider-error reasons ellipsize instead of wrapping), and exposes its presence via a stable `.agent-banner` marker class that downstream layout reads with Tailwind's `group-has-[]:` modifier. The `DashboardShell` wrapper gets a `group` class; both topbar variants and the settings sidebar shift down by exactly `3rem` (the banner height) only when the banner is rendered — no JavaScript measurement, no `ResizeObserver`, no CSS custom properties. Pure CSS, so the layout shift happens in the same paint that mounts the banner.
