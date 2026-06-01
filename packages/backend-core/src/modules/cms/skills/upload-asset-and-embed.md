---
title: CMS: Upload an asset and embed it
description: Two-phase asset upload (request presigned upload → send binary → complete), embed in entries, and audit unused assets.
audiences: [admin]
public: true
---

# Upload an asset and embed it
CMS assets are uploaded out-of-band: the server hands you a **presigned upload**, you send the binary directly to object storage, then you tell the server the upload is done. This avoids streaming binaries through the MCP/HTTP layer. The exact HTTP shape depends on the storage backend — read `uploadMethod` and branch.

## TL;DR

1. `cms_request_asset_upload` — server creates an `uploaded: false` row, returns `uploadUrl`, `uploadMethod`, `uploadFields`, `uploadExpiresAt`.
2. Send the binary to `uploadUrl` using `uploadMethod` (PUT raw body for local self-host; POST multipart for S3, including every field from `uploadFields` plus a `file` part). On S3 the embedded policy enforces `Content-Length-Range` so an oversized body is rejected by the bucket itself.
3. `cms_complete_asset_upload` — verifies the on-storage size matches what was declared, then flips `uploaded: true`. On size mismatch the storage object is deleted; the row stays at `uploaded:false` and you can retry from step 1.
4. Embed by writing the asset id into an entry's `data` field via `cms_update_entry`.

## Step 1 — request the upload

```jsonc
{
  "name": "cms_request_asset_upload",
  "arguments": {
    "name": "spring-launch-hero.jpg",
    "mime": "image/jpeg",
    "sizeBytes": 482301,
    "altText": "Spring launch hero image — three product shots on a sunny patio.",
    "metadata": { "campaign": "spring-2026" }
  }
}
```

Response (PUT-style, local self-host):
```jsonc
{
  "id": "<assetId>",
  "name": "spring-launch-hero.jpg",
  "mime": "image/jpeg",
  "sizeBytes": 482301,
  "uploaded": false,
  "uploadUrl": "http://localhost:3001/static/assets/upload?key=...&sig=...",
  "uploadMethod": "PUT",
  "uploadFields": {},
  "uploadExpiresAt": "2026-05-01T12:34:56Z"
}
```

Response (POST-style, S3):
```jsonc
{
  "id": "<assetId>",
  "uploadUrl": "https://s3.example.com/bucket/",
  "uploadMethod": "POST",
  "uploadFields": {
    "key": "org_x/abc.jpg",
    "Content-Type": "image/jpeg",
    "policy": "<base64-policy>",
    "x-amz-algorithm": "AWS4-HMAC-SHA256",
    "x-amz-credential": "AKIA.../20260501/eu-west-1/s3/aws4_request",
    "x-amz-date": "20260501T123456Z",
    "x-amz-signature": "<hex>"
  },
  "uploadExpiresAt": "2026-05-01T12:34:56Z"
}
```

## Step 2 — send the binary

If `uploadMethod === "PUT"`:

```bash
curl --upload-file ./spring-launch-hero.jpg \
     -H "Content-Type: image/jpeg" \
     "<uploadUrl>"
```

If `uploadMethod === "POST"`:

```bash
curl -X POST "<uploadUrl>" \
     $(printf -- '-F %s=%s ' key "$KEY" Content-Type image/jpeg policy "$POLICY" x-amz-algorithm AWS4-HMAC-SHA256 ...) \
     -F "file=@./spring-launch-hero.jpg"
```

The `file` part must come **last** in the multipart body. Send every key in `uploadFields` as a form field; the embedded policy fixes the allowed byte size to exactly `sizeBytes`, so an oversized body is rejected at S3. Must complete before `uploadExpiresAt` (typically ~15 min).

## Step 3 — complete

```jsonc
{ "name": "cms_complete_asset_upload", "arguments": { "id": "<assetId>" } }
```

Flips `uploaded: true`. Until you call this, the asset is invisible to other tools and entries can't reference it. You can call complete **as long as the row exists** — the URL expires, but the row doesn't.

## Step 4 — embed in an entry

Asset references in entries are stored as the asset id (or a structured `{ assetId, ... }` object — depends on the field's collection schema). Read the entry, write the field, send the update:

```jsonc
{ "name": "cms_get_entry", "arguments": { "id": "<entryId>" } }
```

```jsonc
{
  "name": "cms_update_entry",
  "arguments": {
    "id": "<entryId>",
    "ifVersion": 12,
    "data": { "...all other fields...": "...", "heroImage": "<assetId>" }
  }
}
```

(Use `skill://cms/publish-entry` for the full update + publish dance.)

## Auditing unused assets

```jsonc
{ "name": "cms_list_assets", "arguments": { "limit": 200 } }
```

For each asset you want to verify usage of, walk inbound references on every entry that *might* point at it — there's no `cms_list_referencing_entries(assetId)` shortcut today; you'd grep entry data jsonb. A pragmatic alternative is to use the search API:

```jsonc
{
  "name": "cms_search",
  "arguments": { "query": "<assetId>", "limit": 50 }
}
```

Then inspect those entries to confirm.

## What NOT to do

- **Don't call `cms_complete_asset_upload` before the binary PUT succeeds.** The asset will be marked `uploaded: true` with no actual file — entries referencing it will render broken.
- **Don't lose the `id`.** Without it you can't complete the upload, and the half-uploaded row sits as an orphan (no automatic GC).
- **Don't reuse one presigned URL for multiple files.** Each `cms_request_asset_upload` mints a new URL bound to the size and mime you declared.
- **Don't delete an asset before checking inbound references.** `cms_delete_asset` removes the row + storage file; entries that referenced it will render broken in the delivery API. Search/grep first.

## Related

- `skill://cms/publish-entry` — the update + publish dance for the entry that embeds the asset.
- `skill://cms/migrate-content` — when you're moving assets along with entries.
