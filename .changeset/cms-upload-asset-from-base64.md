---
'@getmunin/backend-core': minor
---

CMS: drop `cms_upload_asset_from_file` (the `openai/fileParams`-based upload tool) and bring back the inline base64 path under a clearer name. The from-file tool didn't survive contact with ChatGPT's Apps SDK runtime — the `openai/fileParams` substitution only fires for files the user explicitly attached to the conversation, never for image-gen outputs that live in the sandbox's `/mnt/data`. ChatGPT's host clamps every such call client-side, so they never reach the server.

The replacement is `cms_upload_asset_from_base64` (renamed from the previously-removed `cms_upload_asset_bytes`), with a tightened 100 KB decoded-size cap (down from 2 MB). The framing in the tool description is explicit about the use case: generated-in-conversation assets that need to land in the CMS without leaving the chat — compress to WebP/JPEG well under 100 KB first, then pass the bytes inline. Anything bigger should go through `cms_upload_asset_from_url`.

Also reworded `cms_request_asset_upload`'s description to call out that it requires a client capable of issuing raw HTTP PUT/POST itself, with a forward pointer to the inline-base64 and from-URL tools for runtimes that don't have that primitive. This is a generic constraint, not a ChatGPT-specific carve-out.

Service-side: the `uploadAssetFromFile` method is gone (had no other callers). `uploadAssetBytes` is renamed to `uploadAssetFromBase64` to match the new tool surface; the control-plane CMS drafts controller and the service tests are updated accordingly.
