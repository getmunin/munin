---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

CMS: lift the dashboard's 100KB image-upload ceiling and stop leaking agent-oriented error strings into the UI.

The dashboard's cover-image upload previously went through the base64 path shared with the `cms_upload_asset_from_base64` MCP tool, inheriting its 100KB cap (which exists to keep agent tool payloads small) and surfacing its raw error message verbatim. Now:

- New control-plane endpoints `POST /v1/cms/drafts/:id/assets/upload-request` and `POST /v1/cms/drafts/:id/assets/:assetId/complete` expose the existing presigned upload flow (up to 50MB), and the dashboard uses them. Note for S3-backed deployments: the bucket CORS policy must allow PUT/POST from the dashboard origin.
- The dashboard downscales images client-side before upload (long edge capped at 2400px, re-encoded as WebP with JPEG/PNG fallback), so stored assets are delivery-ready instead of raw camera files.
- `CmsInvalidError` carries a specific `code` (`cms_asset_too_large` for size-limit rejections), the CMS drafts controller includes `code` in error bodies, and the dashboard inbox/queue surfaces translate known codes through `useTranslateError` (new `errors.*` copy in English and Norwegian) instead of showing raw backend messages.
