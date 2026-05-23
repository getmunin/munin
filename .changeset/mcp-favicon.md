---
'@getmunin/backend-core': patch
---

Serve `/favicon.ico`, `/icon.png`, `/apple-icon.png` from a configurable `iconAssetDir` (default `<cwd>/public/icons`). Browser-based MCP UIs like claude.ai web use the MCP host's favicon to render the custom-integration tile; previously the host returned 404 and claude.ai fell back to a generic globe placeholder.

Missing files silently 404 — backwards-compatible for deployments that don't ship icons.
