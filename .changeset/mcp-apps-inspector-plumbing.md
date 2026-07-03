---
'@getmunin/mcp-toolkit': minor
'@getmunin/backend-core': minor
---

Serve `ui://` MCP App resources (SEP-1865): tools can declare `_meta.ui.resourceUri` pointing at an app-audience HTML resource rendered inline by supporting hosts, with resource-level `_meta` (CSP) passed through `resources/list` / `resources/read`. App resources are kept separate from the `skill://` catalog. Includes the `inspector_hello` spike tool + `ui://inspector/hello` panel, verified end-to-end against claude.ai including the widget-initiated `callServerTool` round trip.
