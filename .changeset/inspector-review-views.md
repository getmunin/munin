---
'@getmunin/backend-core': minor
'@getmunin/inspector-app': minor
'@getmunin/dashboard-pages': minor
---

Extend the inspector MCP App with five new views: CRM merge-proposal review (side-by-side contact comparison with app-only apply/dismiss), KB curation-candidate review (new `kb_list_curation_candidates` tool, app-only `kb_publish_curation_candidate`), analytics charts (views over time, funnel, traffic by source, contact journey), CMS entry preview with publish/unpublish/schedule actions, and a media-library thumbnail gallery. The panel resource now CSP-allows the asset-storage origin so thumbnails render inside the iframe.
