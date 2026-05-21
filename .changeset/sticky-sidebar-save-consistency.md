---
'@getmunin/dashboard-pages': patch
---

Two polish fixes:

- Settings sidebar (nav + sign-out) is now `sticky` under the topbar so scrolling the main content area no longer hides the nav or the sign-out button.
- Account page's save button label and confirmation message now match the rest of the dashboard: `Save` (not `Save changes`) and a muted-gray `Saved` toast (matching `identity-card`/`models-card`) instead of the previous cobalt-blue confirmation.
