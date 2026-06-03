---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
'@getmunin/ui': patch
---

Surface CMS draft entries in the dashboard approval queue. Adds `CmsService.listDraftEntries` + `archiveEntry`, a new `/v1/cms/drafts/*` control endpoint family for approve/schedule/dismiss/patch, and a dedicated CMS drawer with metadata grid, cover-image preview, inline body editor, and a schedule popover. The shared `QueueDrawer` is also split into per-kind files (`queue-drawers/{kb,crm,outreach,feedback,cms}.tsx`) backed by a small dispatcher so adding the next kind is a new file rather than another branch.
