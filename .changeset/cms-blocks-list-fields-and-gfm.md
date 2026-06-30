---
'@getmunin/dashboard-pages': patch
---

Fix two rendering gaps in the CMS draft-approval block editor. Array (string-list) and `multi_select` fields — and array-of-text block props such as a stat block's `items` — no longer fall through to a raw JSON dump: they render as a clean list / comma-separated values, and in edit mode get a proper list editor (add / remove / reorder) and a checkbox group. Markdown prose now renders GitHub-flavored markdown (tables, strikethrough) via `remark-gfm`, so a comparison table in a prose block shows as a table instead of raw pipe-delimited text. The GFM upgrade applies to all shared markdown rendering in the dashboard drawers (KB, outreach, conversation drafts, message bubbles).
