---
title: CMS: Migrate content in bulk
description: Move entries from an external CMS, or copy collections between Munin orgs and servers, idempotently — preserve references, rewrite assets, reconcile schema drift.
audiences: [admin]
---

# Migrate content in bulk
Importing a customer's existing content (Webflow, Contentful, headless WordPress, an old Munin collection) into a Munin CMS collection. Designed to be **idempotent** so a partial run can resume.

**Source is another Munin org or server?** Skip the loop below and use the export/import pair — see [Copy collections between Munin orgs](#copy-collections-between-munin-orgs). The per-row loop is for content that lives outside Munin.

## TL;DR

1. Inspect or design the destination collection schema (`cms_get_collection` / `cms_create_collection`).
2. Pick a stable external id and store it in a custom field so re-runs find existing entries via `cms_search_entries`.
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
  "name": "cms_search_entries",
  "arguments": { "query": "<source-id>", "collection": "blog", "limit": 5 }
}
```

If the search returns a hit and the hit's `data.external` matches exactly, it's the existing entry — update it instead of creating a new one.

## Step 3 — per-row import loop

Pseudocode:

```
for row in source:
  hits = cms_search_entries(query=row.id, collection="blog")
  existing = first hit where data.external == row.id

  payload = {
    title: row.title,
    body: transform(row.body),
    external: row.id,
    hero: <handled in step 4>
  }

  if existing:
    cms_get_entry(existing.id, fields=["external"]) -> { version }
    cms_update_entry(existing.id, ifVersion=version, data=payload, responseFormat="summary")
  else:
    cms_create_entry(collection="blog", slug=row.slug, locale=row.locale, data=payload,
                     status="draft", responseFormat="summary")
```

Pass `responseFormat: "summary"` on every write in the loop. Each call otherwise echoes the full body you just sent, and over a few hundred rows that echo is most of what fills your context. The summary carries `id`, `version` and a word count per long field, which is all the loop needs.

Carry the source row's original publish date across — `cms_create_entry` and `cms_publish_entry` both take a `publishedAt` (ISO 8601) alongside `status: "published"`:

```
cms_create_entry(collection="blog", slug=row.slug, data=payload,
                 status="published", publishedAt=row.published_date)
```

Without it every migrated post is stamped with the moment of the import and the archive loses its chronological order. Don't work around this by adding a `publishedAt` field to the collection — the entry-level one is what the delivery API sorts on.

For assets referenced inline (images in body, hero images): use `skill://cms/upload-asset-and-embed` to upload, then put the new asset id in the entry's `data`. Build a `sourceAssetUrl → muninAssetId` map as you go so you don't re-upload duplicates.

For body content with rich-text references to other entries (cross-links), defer until step 4.

## Step 4 — second pass: rewire references

After every entry exists, walk the body fields and replace external links with internal entry ids. For each entry:

```jsonc
{ "name": "cms_get_entry", "arguments": { "id": "<entryId>" } }
```

For each old link, resolve the target via `cms_search_entries` on the source-id-mapped entry, then swap the URL in place with `textReplacements` — one edit per link, `replaceAll: true` when the same link appears more than once in a body:

```jsonc
{
  "name": "cms_update_entry",
  "arguments": {
    "id": "<entryId>",
    "ifVersion": <v>,
    "textReplacements": [
      { "field": "body", "oldText": "https://old-cms/posts/old-id", "newText": "ref://<targetEntryId>", "replaceAll": true }
    ],
    "responseFormat": "summary"
  }
}
```

This leaves every other byte of the body untouched, which matters on a second pass over content you have already spot-checked. A link that no longer appears (edited out since the import) fails with `cms_replacement_no_match` — skip it rather than retrying with a guess.

Verify with `cms_list_inbound_references` on a few entries — outbound links from this entry should now show as inbound references on the target entries.

## Step 5 — verify and publish

```jsonc
{ "name": "cms_list_entries", "arguments": { "collection": "blog", "limit": 200 } }
```

Sanity-check `returned` against the source count. Entries come back as summaries with long text shortened, so body fidelity needs `cms_get_entry` on 2–3 spot checks — or `cms_list_entries` with `"fields": ["body"]` on a handful of `ids` to compare several at once. Then publish in batches per `skill://cms/publish-entry`, passing each row's original `publishedAt`.

## Copy collections between Munin orgs

When the content already lives in Munin — another org on the same deployment, or a self-hosted server moving to cloud (or back) — `cms_export` and `cms_import` move it in two calls: schema, entries, block structure, translation links, original `publishedAt`, and image bytes. You need one connection to each side: an MCP connection pinned to the source org and one pinned to the target.

**1. Export from the source**, scoped to what you're moving:

```jsonc
{ "name": "cms_export", "arguments": { "collections": ["blog"] } }
```

`collections` keeps the payload to those collections, the locales their entries use, and only the assets their entries reference (`asset` fields, asset arrays, assets inside blocks, and inline `asset://` links in prose). Omit it to export the whole CMS. An unknown slug fails the call rather than quietly exporting less.

Assets come back as metadata plus a `sourceUrl`, not bytes, so the export stays a few KB however many images the posts carry. **Don't reach for base64 to move images** — pulling every image into your context is what makes a migration slow and fragile.

**2. Import into the target**, passing the export result through unchanged as `records`:

```jsonc
{ "name": "cms_import", "arguments": { "records": { "locales": [...], "collections": [...], "entries": [...], "assets": [...] } } }
```

The target server downloads every `sourceUrl` itself and re-uploads it to its own storage, then rewrites asset and entry ids in each entry to the new local ids. Published entries keep their source `publishedAt`, archived stay archived, and a still-future schedule carries over.

**3. Read `warnings`.** The ones to act on:

- `asset "…" bytes could not be downloaded from …; imported metadata only` — the target could not fetch the URL. The asset exists as a placeholder with no bytes, and entries already point at it. Re-run the same import once the URL is reachable: the placeholder is filled in place (it counts as `updated`), so entries keep their asset ids. If the source can never be reached from the target, switch to `includeAssetBytes` (below).
- `entry "…" skipped: source collection … was not part of this import` — the entry's collection wasn't in `records`.

**When the target can't reach the source's asset URLs** (a self-hosted source on a private network or localhost), export with `"includeAssetBytes": true` to inline each asset as base64 (assets over 5MB stay metadata only). Expect a large result in that mode. A request body is capped at 4MB, so split the import: send `locales`, `collections` and a first slice of `assets` (with `entries: []`), then the remaining asset slices, then `entries` on their own — empty arrays for the parts a call doesn't carry, and each call's returned `idMap` passed into the next, so the final entries call resolves every collection and asset to its new id.

**Re-running is safe.** Collections match by slug, entries by (collection, slug, locale), assets by (name, size) — a second run updates changed entries, fills asset placeholders a previous run left without bytes, and skips the rest. That also means an existing collection on the target keeps *its* schema; the import does not overwrite field definitions. Reconcile schema first with `cms_update_collection` if the two have drifted.

**Cross-collection references.** A `reference` field pointing at an entry in a collection you left out of `collections` keeps the source entry id, which resolves to nothing on the target. Export the referenced collection too, or pass the `idMap` from an earlier import that brought those entries across.

## What NOT to do

- **Don't run without an idempotency key.** A failed mid-run import that re-runs without a key creates duplicates with the same slug + locale, which fails uniqueness. With a key, the second run updates instead.
- **Don't skip the second pass.** Cross-links in body content will resolve to dead URLs unless rewritten.
- **Don't delete the destination collection to "start over" on a stuck import.** `cms_delete_collection` cascades to entries and their versions, plus any inbound references break. Update the schema instead, or import into a new collection slug.
- **Don't hand-copy Munin-to-Munin content through the per-row loop.** Between Munin orgs, `cms_export` → `cms_import` keeps block structure, translation groups, publish dates and assets intact; re-creating entries one at a time with base64 uploads loses those details and wastes context.
- **Don't bulk-publish without spot checks.** Publishing all-at-once means a malformed transformation hits production for every entry simultaneously.

## Related

- `skill://cms/publish-entry` — publishing entries after import.
- `skill://cms/upload-asset-and-embed` — uploading images referenced from imported content.
- `skill://cms/localize-entry` — when source content is per-locale.
- `skill://playbooks/data-migration` — moving a whole org (KB, CRM, CMS, conversations, outreach, analytics) between servers.
