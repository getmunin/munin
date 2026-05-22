---
title: Migrate content in bulk
description: Move entries from an external CMS (or between Munin collections) idempotently — preserve references, rewrite assets, reconcile schema drift.
audiences: [admin]
---

# Migrate content in bulk
Importing a customer's existing content (Webflow, Contentful, headless WordPress, an old Munin collection) into a Munin CMS collection. Designed to be **idempotent** so a partial run can resume.

## TL;DR

1. Inspect or design the destination collection schema (`cms_get_collection` / `cms_create_collection`).
2. Pick a stable external id and store it in a custom field so re-runs find existing entries via `cms_search`.
3. For each source row: search for an existing entry → create new or update existing.
4. Rewire references after all entries are imported (two-pass).
5. Verify count, spot-check a few entries.

## Step 1 — destination schema

If migrating into a new collection:

```jsonc
{ "name": "cms_list_collections", "arguments": {} }
```

```jsonc
{
  "name": "cms_create_collection",
  "arguments": {
    "name": "Blog",
    "slug": "blog",
    "fields": [
      { "name": "title",    "type": "text",     "required": true },
      { "name": "body",     "type": "richtext", "required": true },
      { "name": "external", "type": "text",     "required": false },
      { "name": "hero",     "type": "asset",    "required": false }
    ],
    "localized": true
  }
}
```

The `external` field is your import key — store the source system's id here so re-runs are idempotent.

If the collection already exists but needs new fields:

```jsonc
{
  "name": "cms_update_collection",
  "arguments": { "idOrSlug": "blog", "patch": { "fields": [...new full list...] } }
}
```

Field changes are partly lossy — dropped or renamed fields remain in entries' `data` jsonb but aren't projected through the API. The data isn't deleted; it's just hidden.

## Step 2 — idempotency key

Decide on the source identifier (e.g. Contentful entry id, WordPress post id) and treat it as your import key. Every imported entry gets `data.external = "<source-id>"`. Before creating, look it up:

```jsonc
{
  "name": "cms_search",
  "arguments": { "query": "<source-id>", "collection": "blog", "limit": 5 }
}
```

If the search returns a hit and the hit's `data.external` matches exactly, it's the existing entry — update it instead of creating a new one.

## Step 3 — per-row import loop

Pseudocode:

```
for row in source:
  hits = cms_search(query=row.id, collection="blog")
  existing = first hit where data.external == row.id

  payload = {
    title: row.title,
    body: transform(row.body),
    external: row.id,
    hero: <handled in step 4>
  }

  if existing:
    cms_get_entry(existing.id) -> { version }
    cms_update_entry(existing.id, ifVersion=version, data=payload)
  else:
    cms_create_entry(collection="blog", slug=row.slug, locale=row.locale, data=payload, status="draft")
```

For assets referenced inline (images in body, hero images): use `skill://cms/upload-asset-and-embed` to upload, then put the new asset id in the entry's `data`. Build a `sourceAssetUrl → muninAssetId` map as you go so you don't re-upload duplicates.

For body content with rich-text references to other entries (cross-links), defer until step 4.

## Step 4 — second pass: rewire references

After every entry exists, walk the body fields and replace external links with internal entry ids. For each entry:

```jsonc
{ "name": "cms_get_entry", "arguments": { "id": "<entryId>" } }
```

Rewrite the body so any `<a href="https://old-cms/posts/old-id">` becomes a Munin entry reference (resolve via `cms_search` on the source-id-mapped entry). Then:

```jsonc
{
  "name": "cms_update_entry",
  "arguments": { "id": "<entryId>", "ifVersion": <v>, "data": {...rewritten...} }
}
```

Verify with `cms_list_inbound_references` on a few entries — outbound links from this entry should now show as inbound references on the target entries.

## Step 5 — verify and publish

```jsonc
{ "name": "cms_list_entries", "arguments": { "collection": "blog", "limit": 200 } }
```

Sanity-check the count against the source. Spot-check 2–3 entries (`cms_get_entry`) for body fidelity. Then publish in batches per `skill://cms/publish-entry`.

## What NOT to do

- **Don't run without an idempotency key.** A failed mid-run import that re-runs without a key creates duplicates with the same slug + locale, which fails uniqueness. With a key, the second run updates instead.
- **Don't skip the second pass.** Cross-links in body content will resolve to dead URLs unless rewritten.
- **Don't delete the destination collection to "start over" on a stuck import.** `cms_delete_collection` cascades to entries and their versions, plus any inbound references break. Update the schema instead, or import into a new collection slug.
- **Don't bulk-publish without spot checks.** Publishing all-at-once means a malformed transformation hits production for every entry simultaneously.

## Related

- `skill://cms/publish-entry` — publishing entries after import.
- `skill://cms/upload-asset-and-embed` — uploading images referenced from imported content.
- `skill://cms/localize-entry` — when source content is per-locale.
