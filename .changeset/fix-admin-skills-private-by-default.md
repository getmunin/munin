---
'@getmunin/backend-core': patch
---

**Security**: admin-audience skills and tools default to private on the anonymous catalog endpoints. Existing skills in this repo are explicitly opted back in.

- `skill-loader.ts`: a skill defaults to public only when its `audiences` include
  `self_service`. Admin-only skills must opt in with `public: true` in
  frontmatter. Task URIs remain private regardless.
- `PublicMcpToolsController` (`/v1/public/mcp-tools`) only lists tools whose
  `audiences` include `self_service`. Admin tool schemas are no longer
  enumerable anonymously. Authenticated admin agents still see them via the
  MCP `tools/list` call.

Every existing OSS skill (26 files) now declares `public: true` explicitly — the
docs site keeps publishing the same content. The change is forward-looking:
new admin skills must be reviewed and explicitly opted in.
