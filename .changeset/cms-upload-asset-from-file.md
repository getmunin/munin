---
'@getmunin/backend-core': minor
'@getmunin/mcp-toolkit': minor
---

Replace `cms_upload_asset_bytes` with `cms_upload_asset_from_file`, a ChatGPT-native upload path.

The base64-bytes tool didn't work for any realistic image from ChatGPT workspace agents — JSON-encoded base64 blew past the tool-call token budget around 2–3 MB. The new tool declares `_meta["openai/fileParams"]: ["file"]` so ChatGPT hands the server a short-lived signed download URL for a file already in the conversation; the backend fetches it through the existing `safeFetch` + SSRF + 50 MB cap path. Accepts `image/*`, `video/*`, `audio/*`, and `application/pdf`; SVG rejected.

The `uploadAssetBytes` service method is kept (the dashboard's `/v1/cms/drafts/:id/assets` REST endpoint still uses it); only the MCP tool was removed.

Also: `@McpTool` now accepts an optional `_meta` bag that flows through to `tools/list` entries, so any module can attach OpenAI Apps-SDK metadata (or future MCP extensions) without changing the toolkit.
