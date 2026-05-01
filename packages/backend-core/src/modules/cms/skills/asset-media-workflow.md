---
title: CMS asset upload + embed workflow
description: Two-phase asset upload (request presigned URL → PUT binary → complete), embed in entries, and audit unused assets.
audiences: [admin]
---

# CMS asset upload + embed workflow

CMS assets are uploaded out-of-band: the server hands you a **presigned URL**, you PUT the file directly to object storage, then you tell the server the upload is done. This avoids streaming binaries through the MCP/HTTP layer.

## TL;DR

1. `cms_request_asset_upload` — server creates an `uploaded: false` row, returns `uploadUrl` + `uploadExpiresAt`.
2. PUT the binary to `uploadUrl` (this is **not an MCP call**; the agent or a connector executes it directly against storage).
3. `cms_complete_asset_upload` — flips `uploaded: true`. Now the asset is referenceable.
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

Response:
```jsonc
{
  "id": "<assetId>",
  "name": "spring-launch-hero.jpg",
  "mime": "image/jpeg",
  "sizeBytes": 482301,
  "uploaded": false,
  "uploadUrl": "https://storage.example/...?X-Amz-Signature=...",
  "uploadExpiresAt": "2026-05-01T12:34:56Z"
}
```

## Step 2 — PUT the binary

The presigned URL is a direct upload target. From a connector or the agent's environment:

```bash
curl --upload-file ./spring-launch-hero.jpg \
     -H "Content-Type: image/jpeg" \
     "<uploadUrl>"
```

Must complete before `uploadExpiresAt` (typically ~1 hour). Headers must match the `mime` you declared in step 1.

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

(Use `skill://cms/entry-publish-workflow` for the full update + publish dance.)

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

- `skill://cms/entry-publish-workflow` — the update + publish dance for the entry that embeds the asset.
- `skill://cms/content-migration` — when you're moving assets along with entries.
