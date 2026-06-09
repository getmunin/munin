---
'@getmunin/backend-core': minor
---

Pin playbooks to the top of the MCP "Frequently relevant" skills list, and point scaffolding tools at the frontend-integration playbook.

Coding-agent platforms (Lovable, Bolt, v0, Replit, Cursor) routinely scaffold a frontend against Munin without reading `skill://playbooks/frontend-integration`, then re-discover the same gotchas (CMS CORS, embed paths, host probing). The skill exists and is registered, but two things hid it: (1) the MCP server-instructions `Frequently relevant` block picked the first 6 admin skills alphabetically by URI, which is all `analytics/*` and `cms/*` — playbooks sit at position 28+; (2) agents that skip `resources/list` and read only tool descriptions never see a pointer.

- `mcp.skill-registry.service.ts` now pins all `skill://playbooks/*` first, then fills the remainder alphabetically, and bumps the cap from 6 to 8 so non-playbook skills still appear.
- `conv_widget_create_channel`, `analytics_create_tracker`, and `cms_list_collections` descriptions now reference `skill://playbooks/frontend-integration` so agents that skip resource discovery still get nudged.
