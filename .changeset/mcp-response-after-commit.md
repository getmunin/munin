---
'@getmunin/backend-core': patch
'@getmunin/core': patch
---

Flush MCP responses only after the request's tenant transaction commits.

`TenancyInterceptor` wraps each authenticated request in a transaction, but the MCP controller's `transport.handleRequest` writes the JSON-RPC response to the socket from inside that transaction — so the response (and any returned data, e.g. a freshly minted tracker key) reached the client before the write committed. A client that immediately used the result against another endpoint could read-after-write through a separate DB connection and miss the not-yet-committed row.

The MCP POST handler now buffers its (stateless, JSON) response and flushes it via a new `RequestContext.afterCommit` hook that `TenancyInterceptor` runs once the transaction has committed. GET (SSE streaming) is unaffected. This removes a read-after-write race that surfaced as a flaky analytics tracker integration test.
