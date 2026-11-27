---
"@getmunin/backend-core": patch
"@getmunin/chat-widget": patch
"@getmunin/inspector-app": patch
---

Move three runtime dependencies to their next major version. `imapflow` 2 (inbound email polling) is a TypeScript rewrite of the same client with an unchanged API. `@modelcontextprotocol/ext-apps` 2 moves the inspector panel onto MCP SDK 2, which the panel already used for its types; the MCP Apps wire protocol is unchanged, so panels keep rendering in hosts on either version. `@vapi-ai/web` 3, bundled into the chat widget's voice mode, upgrades Daily's call client from 0.87 to 0.94 with no SDK API changes. `@types/node` now matches the Node 24 runtime the workspace already requires.
