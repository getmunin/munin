---
"@getmunin/backend-core": minor
---

CMS: first-class blocks for rich in-article content. A new `blocks` field type holds an ordered list of typed components (callouts, galleries, product cards, …), each block type being a named set of fields declared in `options.blockTypes`. Assets and entry references embedded inside blocks — typed props and inline `asset://` tokens in block prose — are validated on write, expanded on read (with the `_assets` sidecar), indexed for search, and tracked for deletion safety, exactly like top-level fields.

Adds opt-in reference expansion: pass `?include=references` on the delivery API or `include: ["references"]` to `cms_get_entry` / `cms_list_entries` to resolve `reference` fields (top-level and inside blocks) one level deep into `{ id, slug, collection, locale, data }`; the default still returns raw ids.

`json` is now scoped to opaque, non-renderable data: the server rejects `asset://` tokens and block-shaped arrays inside a `json` field, pointing authors at `blocks` instead. New skill `skill://cms/author-with-blocks`.
