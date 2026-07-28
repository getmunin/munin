---
'@getmunin/backend-core': minor
'@getmunin/core': minor
'@getmunin/db': minor
'@getmunin/types': minor
---

CMS: keep the master, serve derivatives. Image assets now carry a ladder of WebP renditions and the delivery API hands out the light one.

Until now an asset was delivered exactly as uploaded. The dashboard downscaled client-side before upload, but every other path — `cms_upload_asset_from_base64`, `cms_upload_asset_from_url`, presigned uploads, and generated images — stored whatever bytes arrived and served them verbatim. A 2.2MB PNG hero and a 99KB hand-uploaded JPEG could sit in the same library with no policy between them.

- `cms_assets` gains `width`, `height`, `variants`, and `variants_version`. Variants are derived state: the original upload is always preserved as the master at `public_url`.
- Uploads derive renditions at 320/640/1024/1536/2048px plus one full-size recompress (capped at 2560px), skipping any width at or above the source so nothing is ever upscaled. WebP at quality 80. For a 1536×1024 master the whole ladder costs ~10% of the master's bytes.
- The delivery API rewrites inline `asset://` tokens to the widest variant instead of the master, and `AssetSummary` (typed asset fields and the `_assets` sidecar) now carries `width`, `height`, and the full variant list so consumers can build a `srcset`. Assets without variants keep resolving to the master, so nothing breaks while the library converges.
- Generation is not a one-shot backfill. The existing CMS worker reconciles any asset below the current ladder version, which covers assets that predate this change, presigned uploads whose bytes arrived late, and generation that failed on the upload path. Changing the ladder later is a version bump rather than a new migration script, and generation on upload is therefore an optimisation rather than a correctness requirement.
- Non-images and undecodable bytes are settled once so the worker stops reclaiming them. Batch size is tunable with `MUNIN_CMS_VARIANT_BATCH` (default 10 per tick).
