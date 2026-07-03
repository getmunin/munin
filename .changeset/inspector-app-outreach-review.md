---
'@getmunin/inspector-app': minor
'@getmunin/backend-core': minor
---

Munin Inspector MCP App: new `@getmunin/inspector-app` package builds the `ui://munin/inspector` panel (React, single self-contained HTML, SDK bundled — no CDN) with an outreach proposal review view and the hello diagnostics view. New `outreach_approve_proposal` / `outreach_dismiss_proposal` admin tools expose the existing decision surface over MCP (declared panel-only via `_meta.ui.visibility: ["app"]` so MCP App hosts hide them from the model — sends require a human click); `outreach_list_proposals` and `inspector_hello` now declare `_meta.ui.resourceUri` so supporting hosts render the panel inline, with approve/dismiss round-tripping over the widget channel. Adds `skill://outreach/review-proposals`.
