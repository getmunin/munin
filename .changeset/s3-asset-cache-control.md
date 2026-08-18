---
'@getmunin/core': minor
'@getmunin/backend-core': patch
---

Send `Cache-Control` on S3 asset uploads so CMS images are cacheable.

Assets stored on S3 have been served with no `Cache-Control` header since the provider
was written, so every browser re-downloaded every CMS image on every page view. A
Lighthouse audit of a site backed by this storage reported `cacheLifetimeMs: 0` against
four CMS images totalling ~222 KB, one of them the LCP candidate.

The header could not be added by any caller. Uploads go browser-to-bucket under a
presigned POST policy minted by `signPostPolicy`, which signed only `key`,
`Content-Type`, `content-length-range` and the SigV4 fields. A field absent from the
policy cannot be added to the form without invalidating the signature, and S3 has no
bucket-level default. `signPutHeaders`, used by `writeDirect` for server-generated
bytes such as image variants, omitted it too. The local-disk provider was never
affected — `staticAssetsMiddleware` has always set its own cache header — so this only
ever showed up on S3 deployments.

`S3CompatibleStorage` now defaults to `public, max-age=31536000, immutable` and applies
it in three places: as a policy condition, as a matching `uploadFields` entry, and as a
signed header on the direct PUT. `immutable` is safe because asset keys are never
reused — `cms/<orgId>/<random>.<ext>` per upload, with variants derived from that random
base — so the bytes at a key never change. Override with the `cacheControl` constructor
option or `MUNIN_STORAGE_S3_CACHE_CONTROL`.

Every existing uploader already forwards the whole `uploadFields` map
(`dashboard-pages/src/lib/upload-image.ts`, the cloud media service, and the
`cms/upload-asset-and-embed` skill), so the new field needs no client change. The skill
markdown now shows it in the example response and states that each field is a signed
condition, since dropping one is what a partial implementation would get wrong.

Objects already in a bucket keep their missing header — the policy only governs new
uploads. Operators wanting the old behaviour back can set
`MUNIN_STORAGE_S3_CACHE_CONTROL` to whatever they prefer.
