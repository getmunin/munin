---
'@getmunin/dashboard-pages': patch
---

Fix the CMS and KB queue drawers hanging on "Loading…" when their detail fetch fails. Previously a failed `/v1/cms/drafts/:id` or `/v1/kb/curation/candidates/:id` request (e.g. a 404) was swallowed, leaving the drawer stuck on the loading text indefinitely with the approve/dismiss actions still clickable.

- Surface detail-fetch errors instead of swallowing them, keyed per queue item.
- Replace the inline "Loading…" text box with a centered spinner in the middle of the drawer.
- Show a centered error message with a retry button when the detail fails to load.
- Disable the approve/dismiss/edit/schedule actions (and the ⌘↵ shortcut) while the detail is loading or errored.
