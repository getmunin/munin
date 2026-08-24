---
'@getmunin/dashboard-pages': patch
'@getmunin/ui': patch
---

Fix three mobile-viewport regressions in the dashboard shell.

Side sheets were sized with `h-full` on a `position: fixed` element, which resolves against the initial containing block — on iOS Safari that is the *large* viewport, so the bottom of every drawer sat behind the browser toolbar and the footer actions (approve, dismiss, cancel scheduled) were half-covered. They now use `100dvh` anchored to the top, which tracks the toolbar as it collapses and expands.

The docs-link row under the Connect MCP snippet on Get started could not shrink: the docs URL is one long unbreakable token, so the flex row overflowed its card and pushed the copy button past the right edge of the viewport. The link may now wrap and the button no longer shrinks.

The dashboard topbar used an 8px gap on mobile, which left the org selector nearly touching the logo once a `leftSlot` was supplied. Mobile now gets 16px; the desktop gap (which also has a rule between the two) is unchanged.
