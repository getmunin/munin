---
'@getmunin/backend-core': minor
---

CMS: migrated content keeps its original publication date

`publishedAt` was stamped `new Date()` on every path that publishes an entry, and nothing could override it. It was not accepted by `cms_create_entry` or `cms_publish_entry`, `cms_schedule_publish` refuses past dates, and `cms_export` did not carry the column at all — so `cms_import` re-created every published entry through `createEntry` and dated the whole set to the moment of the import. Moving a blog between two Munin servers silently collapsed its archive into a single day, and importing one from another CMS had no way to keep the real dates. The workaround was to duplicate the date into a `publishedAt` field on the collection and sort the frontend on `data.publishedAt` instead of the built-in column.

- `cms_create_entry` accepts an optional `publishedAt` (ISO 8601) alongside `status: "published"`. Passing it on a draft is a `cms_invalid` error rather than a silently ignored argument; an unparseable value is rejected the same way.
- `cms_publish_entry` accepts the same optional `publishedAt`, so an entry imported as a draft can be published with its historical date. Omitting it still stamps now.
- `cms_export` emits `publishedAt` per entry and `cms_import` (and `POST /v1/cms/transfer/import`) restores it when creating a published entry, so a server-to-server transfer round-trips the date. Importing an export produced by an older server leaves the field absent and falls back to the previous behavior.

The delivery API already orders by `publishedAt` descending, so a frontend archive sorts on the built-in column with no duplicate field in `data`. `skill://cms/migrate-content`, `skill://cms/publish-entry`, `skill://cms/design-collection` and `skill://playbooks/data-migration` document this; the blog archetype in `design-collection` no longer suggests a redundant `publishedAt` field.

The same import loop flattened the other two statuses. `cms_import` mapped every non-published entry to `draft`, so archived entries came back as live drafts in the editing queue and the `scheduledAt` that `cms_export` emitted was never read by anything:

- Archived entries import as `archived`.
- An entry still scheduled for a future time imports as `scheduled` with its `scheduledAt`, and the target's schedule worker publishes it.
- An entry whose `scheduledAt` has already passed imports as a `draft` with a warning naming the entry and the stale time. A months-old export must not publish unreviewed content on the target the minute it lands, so the schedule is dropped deliberately rather than honored late — re-schedule with `cms_schedule_publish` or publish directly.

Entries that already exist on the target are unchanged here: import still patches their content and leaves the target's own `status`, `publishedAt` and `scheduledAt` alone.
