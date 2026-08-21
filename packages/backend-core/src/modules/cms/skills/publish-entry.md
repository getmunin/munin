---
title: 'CMS: Publish an entry'
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

If you're picking from the queue: `cms_list_entries` with `{ "status": "draft", "limit": 50 }` first. That returns `{ entries, returned, dropped, truncated }` with long text shortened to a lead — enough to choose a draft, not enough to review one. Read the chosen entry in full before editing it.

## Step 2 — refine the draft

```jsonc
{
  "name": "cms_update_entry",
  "arguments": {
    "id": "<entryId>",
    "ifVersion": 7,
    "data": { /* just the keys you want to change; omitted keys are preserved. Send `key: null` to clear. */ },
    "slug": "optional-new-slug",
    "locale": "optional-new-locale"
  }
}
```

Update merges the patch into the existing payload, then increments `version` to 8 and re-validates the merged result against the collection schema, regenerates the search-text + embedding, and rewires inbound references. **You now have version 8** — use it for the next write.

If you get a `cms_version_conflict` error, re-read with `cms_get_entry` and retry. Don't blindly bump the number.

## Step 3 — publish

### Immediate

```jsonc
{ "name": "cms_publish_entry", "arguments": { "id": "<entryId>", "ifVersion": 8 } }
```

Stamps `publishedAt`, flips `status: 'published'`, returns the entry at version 9.

### Backdated (migrated content)

```jsonc
{
  "name": "cms_publish_entry",
  "arguments": {
    "id": "<entryId>",
    "ifVersion": 8,
    "publishedAt": "2019-04-12T08:30:00Z"
  }
}
```

Pass `publishedAt` when the entry was originally published somewhere else — importing a blog from another CMS, for instance. Without it every migrated article gets today's date and the archive loses its chronological order. `cms_create_entry` takes the same field alongside `status: "published"`, so a one-shot import can set it at creation time. The delivery API orders by `publishedAt` descending, so this is what a frontend archive sorts on — no need to duplicate the date into a `data` field.

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

Scheduled entries are listed under **Scheduled** on the dashboard overview alongside scheduled outreach sends, where an operator can read the entry and call the publish off. Calling it off returns the entry to `draft` and clears `scheduledAt` — the same transition as `cms_unpublish_entry`.

## Publishing announces itself in Slack

Not a step — there is nothing to call, and no reason to post to Slack yourself after publishing. If the org has Slack connected, the publish itself posts an announcement (":rocket: *Published* — *\<title\>*", the collection and locale, and a link to the live article) into the `content` channel when one is routed, otherwise the default channel. Scheduled publishes announce when the worker promotes them. Telling the operator where it will land is `skill://slack/connect-slack`.

Two things you *can* do to make it useful:

- **Set a live URL template**, once per collection, so Munin can link the rendered article. Placeholders: `{slug}`, `{locale}`, `{collection}` (percent-encoded on substitution). Without it the announcement still posts, just without a link.

  ```jsonc
  {
    "name": "cms_update_collection",
    "arguments": {
      "idOrSlug": "blog",
      "patch": {
        "settings": {
          "liveUrl": "https://www.example.com/{locale}/blog/{slug}",
          "previewUrl": "https://www.example.com/api/preview?token={token}&slug={slug}&locale={locale}"
        }
      }
    }
  }
  ```

  `settings` REPLACES the stored object — read the collection first and send back every key you want to keep (`previewUrl` above is a reminder, not a requirement). A template that doesn't resolve to an `http(s)` URL is ignored, and the announcement posts without a link.

- **Give the collection a title-ish field.** The headline comes from the entry's `title`, `headline`, `name`, or `heading` field, in that order; with none of them the slug is used.

Re-publishing an entry that is already `published` (a no-op status transition) does not announce again — only a real draft/scheduled → published move does.

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

- `skill://cms/preview-entry` — the draft-side sibling of `settings.liveUrl`.
- `skill://slack/connect-slack` — routing the channel publish announcements land in.
- `skill://cms/localize-entry` — managing per-locale entries.
- `skill://cms/upload-asset-and-embed` — how to embed assets in entry data.
- `skill://cms/migrate-content` — moving entries between collections.
