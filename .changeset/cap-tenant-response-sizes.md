---
"@getmunin/core": patch
"@getmunin/backend-core": patch
"@getmunin/agent-host": patch
"@getmunin/agent-runtime": patch
---

fix(security): cap response sizes from org-chosen hosts and IMAP servers

`safeFetch` now limits how much of a response body it will deliver, counted after decompression: 16 MB by default, adjustable per call with `maxResponseBytes`. A response whose `content-length` already exceeds the limit is refused before its body is read, and a body that grows past it while streaming fails with `ResponseTooLargeError` (`code: 'response_too_large'`). Previously only the destination was checked, so a store, booking system, custom MCP server, LLM provider or webhook receiver configured by any organization could answer with a gzip bomb or an endless body and exhaust the memory of the process every organization shares. Streaming reads, such as provider and MCP event streams, still arrive chunk by chunk. `safeFetchCompat`, which the MCP client uses, goes through the same limit. `findResponseTooLarge(err)` finds the error behind a wrapper.

Connector calls report an oversized vendor response as `connectors_vendor_error` (and a failed connection test), rather than a 500. Callers that legitimately take more set their own limit: CMS asset upload from a URL (50 MB) and social post media (the platform's video limit). Callers that already enforced a smaller limit pass it through: website import pages (5 MB) and OAuth client icons (256 KB). Webhook deliveries and rate-limited provider retries now discard the response body they never read.

IMAP connections for email channels, in the poller and in `conv_test_email_channel`, replace the library's gigabyte-scale parser defaults with 1 MB lines, 40 MB literals and 48 MB responses. The poller asks for each new message's size first and downloads at most 64 MB per poll; a message the server reports as larger than 40 MB is skipped and logged instead of downloaded, and the cursor moves past it only once every earlier message has been stored. A server that sends more than it declared fails the poll, which counts toward the channel's failure backoff like any other connection error.
