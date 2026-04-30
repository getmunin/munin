---
'@getmunin/mcp-toolkit': minor
'@getmunin/backend-core': minor
---

Publish runbooks to connecting MCP agents via the spec's standard primitives.

- `@getmunin/mcp-toolkit` adds `RunbookRegistry` (parallel to `McpToolRegistry`) and extends `createMcpServer` with optional `runbooks` and `instructions` fields. When runbooks are provided the server declares the `resources` capability and registers `resources/list` + `resources/read` handlers, audience-filtered the same way tools are.
- `@getmunin/backend-core` ships a markdown runbook loader that scans `src/modules/**/runbooks/*.md` at boot, parses YAML frontmatter, and registers each into a `RunbookRegistry`. The MCP controller passes the registry plus an auto-generated `instructions` string into every per-request server.
- Five starter runbooks: email-channel-setup, widget-onboarding, handoff-from-ai-agent, customer-onboarding, kb/import-from-google-docs.
- Build step copies `*.md` from `src` to `dist` so runbooks ship inside the published tarball.

Result: agents connecting to `/mcp` get a short orientation in their `initialize` response (`instructions` field) and can discover detailed workflow guides via `resources/list`.
