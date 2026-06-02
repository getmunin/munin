---
'@getmunin/backend-core': minor
'@getmunin/core': minor
---

Add `cms_upload_asset_bytes` MCP tool: agentic clients can now upload small assets (≤2 MB after base64 decode) in a single call, without the `cms_request_asset_upload` → out-of-band S3 PUT → `cms_complete_asset_upload` round-trip. The new tool decodes server-side, writes the bytes through the storage abstraction, and persists the row already marked `uploaded: true`. SVG is rejected on the same grounds as the request/complete path. For larger files the existing two-step flow remains the right shape.

To support this, `S3CompatibleStorage` now implements `writeDirect` using a SigV4 `PUT` with full-payload `x-amz-content-sha256` hashing (compatible with strict S3 implementations). The Nest JSON body limit moves from the Express default (~100 kB) to 4 MB to accommodate base64-inflated payloads.
