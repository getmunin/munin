---
"@getmunin/dashboard-pages": patch
---

Split the 1.7k-line `inbox-sections.tsx` into focused modules (`inbox-types`, `inbox-helpers`, `inbox-data` hook, `inbox-message-bubble`, `inbox-activity-rail`, `inbox-conv-drawers`), with `inbox-sections` retained as the section/list components plus a re-export of the public API. Pure refactor — no behavior change.
