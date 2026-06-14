---
"@getmunin/mcp-toolkit": minor
---

Expose skills and playbooks through `skills_list` / `skills_read` MCP tools in addition to the existing `resources/list` / `resources/read` surface. Coding-agent MCP clients (Lovable, Bolt, Cursor, …) that implement only tools and ignore server resources could not discover `skill://` playbooks; the new tools give them the same content and URIs. The tools appear in `tools/list` only when at least one skill is visible to the caller's audience, respect the same audience gating as resources, and are also listed in the public tool catalog (`/v1/public/mcp-tools`). Both surfaces derive from a single `SKILL_TOOLS` descriptor so they cannot drift.
