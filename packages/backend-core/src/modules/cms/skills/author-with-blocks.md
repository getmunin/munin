---
title: 'CMS: Author content with blocks'
description: Define typed block types on a collection and author rich in-article content (callouts, galleries, product cards) whose embedded assets and entry references are validated, expanded on read, and tracked for deletion safety.
audiences: [admin]
---

# Author content with blocks

A `blocks` field holds an ordered list of typed components — the way to put richer structure (callouts, galleries, embeds, product cards) inside an article instead of a single prose body. Each block type is a named set of fields, so everything you can do with a top-level field (assets, references, inline `asset://` images, validation) works inside a block too.

Use `blocks` for renderable structured content. Use `json` only for opaque, non-renderable data (config, metadata) — `json` is never expanded, never indexed, and not covered by the asset delete guard, and the server rejects `asset://` tokens or block-shaped arrays inside it.

## 1 — Declare block types on the collection

A `blocks` field carries its allowed block types in `options.blockTypes`. Each block type has a `name` (lowercase, the same rules as field names), an optional `label`, and a list of `fields` (any field types except `blocks` — blocks cannot nest).

```jsonc
{
  "name": "cms_create_collection",
  "arguments": {
    "name": "Articles",
    "slug": "articles",
    "fields": [
      { "name": "title", "type": "text", "required": true },
      { "name": "slug", "type": "text", "required": true },
      {
        "name": "body",
        "type": "blocks",
        "options": {
          "blockTypes": [
            { "name": "callout", "label": "Callout", "fields": [
              { "name": "tone", "type": "select", "options": { "choices": ["info", "warn"] } },
              { "name": "text", "type": "markdown" }
            ]},
            { "name": "gallery", "label": "Gallery", "fields": [
              { "name": "images", "type": "array", "options": { "items": { "name": "img", "type": "asset" } } }
            ]},
            { "name": "product_card", "label": "Product card", "fields": [
              { "name": "product", "type": "reference", "options": { "targetCollection": "products" } }
            ]}
          ]
        }
      }
    ]
  }
}
```

## 2 — Author block content on an entry

A block instance is `{ "type", "key", "props" }`: `type` names one of the collection's block types, `key` is an opaque stable id for your own list rendering (optional — defaulted if omitted), and `props` holds the values keyed by that block type's field names.

```jsonc
{
  "name": "cms_create_entry",
  "arguments": {
    "collection": "articles",
    "slug": "spring-launch",
    "data": {
      "title": "Spring launch",
      "slug": "spring-launch",
      "body": [
        { "type": "callout", "key": "c1", "props": { "tone": "info", "text": "Now shipping! ![hero](asset://<assetId>)" } },
        { "type": "gallery", "key": "g1", "props": { "images": ["<assetId>", "<assetId2>"] } },
        { "type": "product_card", "key": "p1", "props": { "product": "<productEntryId>" } }
      ]
    },
    "status": "draft"
  }
}
```

`props` are validated against the block type's fields. An unknown block `type`, a missing/non-object `props`, or a bad prop value fails with `cms_invalid` (a clean 400) — fix the block and retry. Inline `asset://<id>` tokens inside a block's `markdown`/`rich_text` prop must reference an already-uploaded asset (see `skill://cms/upload-asset-and-embed`); an unknown inline asset is rejected on write.

## 3 — Reading blocks back

On the delivery API and `cms_get_entry`:

- Typed `asset` props (and `array<asset>`) expand to the full asset object (`publicUrl`, `altText`, `mime`, `sizeBytes`).
- Inline `asset://<id>` tokens in block prose are rewritten to the asset's `publicUrl`, and an `_assets` map (keyed by asset id) is attached alongside `data` for `altText`/dimensions.
- `reference` props stay raw ids by default. Request expansion explicitly: delivery `GET /v1/cms/<org>/articles/<slug>?include=references`, or `cms_get_entry` / `cms_list_entries` with `"include": ["references"]`. Expanded references resolve **one level** to `{ id, slug, collection, locale, data }`; references inside the referenced entry are not followed.

## Linking to another entry inline (`ref://`)

To link or embed another entry from within prose (a `markdown`/`rich_text` field or block prop), write a `ref://<entryId>` token — e.g. `see [our pricing](ref://ent_pricing)`. Unlike `asset://` (which is rewritten to a URL on read), a `ref://` token is **left in place**, because the server doesn't know your site's routing. Instead, under `?include=references` the response carries a `_refs` map keyed by entry id → `{ id, slug, collection, locale, data }`; your renderer detects `ref://<id>`, looks it up in `_refs`, and builds its own link (`/blog/<slug>`) or embed. Tokens whose target isn't published (or doesn't exist) simply have no `_refs` entry.

## What NOT to do

- **Don't nest blocks.** A block type's fields cannot include another `blocks` field.
- **Don't put renderable content in `json`.** Assets, references, and `asset://` tokens in `json` are invisible to expansion and the delete guard; the server rejects the obvious cases. Use `blocks` (or a typed `asset`/`reference` field) instead.
- **Don't reference an asset before it is uploaded.** Inline tokens in block prose are validated on write.

## Related

- `skill://cms/upload-asset-and-embed` — upload an asset and get the id you embed in a block.
- `skill://cms/publish-entry` — the update + publish dance once the block content is ready.
- `skill://cms/design-collection` — choosing field types when you design the collection.
