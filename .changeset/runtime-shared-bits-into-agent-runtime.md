---
'@getmunin/agent-runtime': minor
---

Move the four shared runtime helpers — `createConversationHandler`,
`createMuninRestClient`, `createRealtimeClient`, `openMcpClient` —
from the OSS sidecar app into the agent-runtime package, so the cloud
multi-tenant runner and any future runner can reuse them instead of
maintaining their own copies.

The handler now takes a minimal `HandlerConfig` (the 6 inference-loop
fields: provider URL/key, model, max tool iterations, max history
chars, debounce ms) instead of a deployment-specific config type.
Existing consumers can pass any config object that has those fields.

`@modelcontextprotocol/sdk` and `ws` move from the sidecar's
dependencies into agent-runtime's, since they're needed by the
extracted clients. Consumers shouldn't need to add them themselves
anymore.

New exports: `createConversationHandler`, `createMuninRestClient`,
`createRealtimeClient`, `openMcpClient`, plus their option/result/handle
types: `HandlerConfig`, `ConversationHandler`, `ConversationHandlerDeps`,
`IncomingMessage`, `OpenedMcp`, `ConversationDetail`,
`CreateMuninRestClientOptions`, `DelegatedToken`, `MuninRestClient`,
`OpenMcpClientOptions`, `OpenedMcpClient`, `KbDocumentChangedEvent`,
`MessageReceivedEvent`, `RealtimeClient`, `RealtimeClientOptions`.
