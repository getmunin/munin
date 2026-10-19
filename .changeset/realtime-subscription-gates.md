---
"@getmunin/backend-core": patch
---

fix(realtime): the `/v1/realtime` socket now applies the same access rules as the HTTP control plane

- OAuth access tokens issued for `/mcp` are refused on the handshake (`401`), and admin API keys need scope `*` and the admin audience (`403 realtime_forbidden` otherwise).
- Members receive conversation events only, on the `org` and `conversation` channels; owners and admins keep the full org stream.
- Chat widget and end-user sockets receive only visitor-facing conversation events, reduced to the ids needed to refetch (`conversationId`, plus `messageId` / `authorType` on messages and `status` on a status change). Internal notes, drafting instructions, hand-over reasons, operator ids and internal messages are no longer sent to them.
