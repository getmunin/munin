---
title: Publish a CMS entry
description: Move a CMS entry through draft → published — immediate, scheduled, or rolled back — without losing work to optimistic-lock conflicts.
audiences: [admin]
---

# Publish a CMS entry
Every CMS entry has a `status` (`draft | published | scheduled | archived`) and a monotonic `version`. Updates use **optimistic locking**: every write requires the `ifVersion` you read. If somebody else (human or worker) updated the entry between your read and write, the write fails and you must re-read.

## TL;DR

1. `cms_get_entry` to read the current `version`.
2. `cms_update_entry` with `ifVersion` to refine the draft.
3. Decide: publish now (`cms_publish_entry`) or later (`cms_schedule_publish`).
4. If something's wrong post-publish: `cms_unpublish_entry` (back to draft) or `cms_restore_version` (roll forward to a historical version).

## Step 1 — read the draft

```jsonc
{ "name": "cms_get_entry", "arguments": { "id": "<entryId>" } }
```

Returns `{ id, collection, slug, locale, status, data, version, publishedAt, ... }`. Hold on to `version` — every subsequent write needs it.

If you're picking from the queue: `cms_list_entries` with `{ "status": "draft", "limit": 50 }` first.

## Step 2 — refine the draft

```jsonc
{
  "name": "cms_update_entry",
  "arguments": {
    "id": "<entryId>",
    "ifVersion": 7,
    "data": { /* the full updated payload */ },
    "slug": "optional-new-slug",
    "locale": "optional-new-locale"
  }
}
```

Update increments `version` to 8 and re-validates against the collection schema, regenerates the search-text + embedding, and rewires inbound references. **You now have version 8** — use it for the next write.

If you get a `cms_version_conflict` error, re-read with `cms_get_entry` and retry. Don't blindly bump the number.

## Step 3 — publish

### Immediate

```jsonc
{ "name": "cms_publish_entry", "arguments": { "id": "<entryId>", "ifVersion": 8 } }
```

Stamps `publishedAt`, flips `status: 'published'`, returns the entry at version 9.

### Scheduled

```jsonc
{
  "name": "cms_schedule_publish",
  "arguments": {
    "id": "<entryId>",
    "ifVersion": 8,
    "scheduledAt": "2026-05-15T08:00:00Z"
  }
}
```

A worker drains the schedule queue every ~60 seconds. Status becomes `scheduled`; the worker flips it to `published` at or after `scheduledAt`.

## Step 4 — rollback paths

### Unpublish (back to draft)

```jsonc
{ "name": "cms_unpublish_entry", "arguments": { "id": "<entryId>", "ifVersion": 9 } }
```

Clears `publishedAt` and sets `status: 'draft'`. Content unchanged.

### Restore an earlier version

```jsonc
{ "name": "cms_list_versions", "arguments": { "entryId": "<entryId>" } }
```

→ pick the `version` you want to restore.

```jsonc
{
  "name": "cms_restore_version",
  "arguments": { "entryId": "<entryId>", "version": 5, "ifVersion": 9 }
}
```

Restore is itself a write — it creates a *new* version (10) carrying the data from version 5. Old versions remain in history. If the entry was published, it stays published with the restored data.

## What NOT to do

- **Don't reuse a stale `ifVersion`.** Every successful write bumps `version`. The next write must use the *new* number, not the one you originally read.
- **Don't manually publish an entry that's currently `scheduled`.** The worker may run between your manual publish and its own tick, overwriting your data with the older scheduled snapshot. If you need to take over a scheduled entry, `cms_unpublish_entry` first to clear the schedule, then republish manually.
- **Don't skip `cms_list_versions` before restoring.** Versions are 1-indexed and stable, but only the listing tells you what's actually different.

## Related

- `skill://cms/localize-entry` — managing per-locale entries.
- `skill://cms/upload-asset-and-embed` — how to embed assets in entry data.
- `skill://cms/migrate-content` — moving entries between collections.
