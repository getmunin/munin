---
'@getmunin/dashboard-pages': patch
---

Dark mode readability. The OAuth consent screen's body text, inline emphasis, scope pills, reassurance callout and Authorize / Deny / Cancel buttons used the fixed light ink, so on a dark system scheme they rendered dark on dark. Every state (request, media, blocked, wrong account, expired, granted, denied) now carries the same dark variants as the `@getmunin/ui` buttons and the rest of the dashboard. The default Munin raven in the dashboard header, the mobile menu and the standalone 404 / outside-org notices is now inverted on dark so it reads white instead of vanishing. A custom `logoSrc` is left in its own colours, and the auth shell, which is light-locked, is unchanged.
