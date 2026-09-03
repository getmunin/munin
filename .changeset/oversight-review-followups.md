---
'@getmunin/backend-core': patch
'@getmunin/agent-runtime': minor
'@getmunin/dashboard-pages': patch
---

Follow-ups from the oversight code review. The conversation list pager's cursor now carries the needs-attention flag so resuming across the attention boundary drops no rows, and the list tiebreaker matches the cursor (id, not createdAt); the list and queue endpoints share one query parser and the invalid-status error carries the `conv_invalid:` prefix. The review pane surfaces a detail-load failure with a retry instead of spinning forever, the mobile full-screen editor gains dialog semantics (role, Escape to close, focus on open), and the queue's scroll fade is driven by a CSS variable so scrolling no longer re-renders every row. The learning page reports when past decisions fail to load and labels its published/dismissed counts as recent. `SetDraftReplyOpts` is exported from the runtime and reused by the in-process client, the nav-group extension helpers share one generic implementation, agent settings gating keys off `ACCOUNT_SETTINGS_HREF` instead of a URL suffix, and the live-now dot's halo derives from the accent token in both themes.
