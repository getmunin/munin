---
title: CMS: Upload an asset and embed it
description: Two-phase asset upload (request presigned upload → send binary → complete), embed in entries, and audit unused assets.
audiences: [admin]
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

There are two ways to embed an asset, depending on whether it's a standalone field (a cover image, a gallery) or an image placed within prose. Both also work *inside a block* (`skill://cms/author-with-blocks`) — an asset used in a block, as a typed prop or an inline `asset://` token in block prose, is tracked the same way and is covered by the delete guard below.

### As a typed field

A field whose collection type is `asset` (or `array` of `asset`) stores the asset id. Read the entry, write the field, send the update:

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

### Inline in a markdown/rich_text body

To place an image within the prose of a `markdown` or `rich_text` field, embed an `asset://<assetId>` reference — in markdown, as the URL of an image:

```markdown
Intro paragraph.

![Spring launch hero](asset://<assetId>)

More copy.
```

The asset must already be uploaded (`uploaded: true`) — an inline reference to an unknown or unconfirmed asset is rejected when you create/update the entry. On read, the delivery API and `cms_get_entry`/`cms_search` rewrite each `asset://<assetId>` to the asset's `publicUrl` and attach an `_assets` map keyed by asset id so you can also read `altText`, `mime`, and `sizeBytes`.

(Use `skill://cms/publish-entry` for the full update + publish dance.)

## Auditing unused assets

```jsonc
{ "name": "cms_list_assets", "arguments": { "limit": 200 } }
```

To see which entries use a given asset — as a typed field or inline in a body — call:

```jsonc
{ "name": "cms_list_asset_usage", "arguments": { "assetId": "<assetId>" } }
```

It returns one row per reference with `fromEntryId`, `fieldName`, and `kind` (`field` or `inline`). An empty result means the asset is safe to delete.

## What NOT to do

- **Don't call `cms_complete_asset_upload` before the binary PUT succeeds.** The asset will be marked `uploaded: true` with no actual file — entries referencing it will render broken.
- **Don't lose the `id`.** Without it you can't complete the upload, and the half-uploaded row sits as an orphan (no automatic GC).
- **Don't reuse one presigned URL for multiple files.** Each `cms_request_asset_upload` mints a new URL bound to the size and mime you declared.
- **Don't expect to delete an asset that's still in use.** `cms_delete_asset` fails with a conflict while any entry references the asset (field or inline). Call `cms_list_asset_usage` first, then remove the references from those entries before deleting.

## Related

- `skill://cms/publish-entry` — the update + publish dance for the entry that embeds the asset.
- `skill://cms/migrate-content` — when you're moving assets along with entries.
