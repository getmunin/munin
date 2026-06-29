---
"@getmunin/backend-core": minor
---

CMS: `cms_search` reference expansion. Pass `include: ["references"]` to `cms_search` (or `?include=references` on the public delivery search endpoint) to resolve `reference` fields and inline `ref://` tokens on search hits — reference fields expand in place to `{ id, slug, collection, locale, data }` and inline tokens are surfaced in a `_refs` sidecar, matching the behavior of `cms_get_entry` / `cms_list_entries` and the entry delivery endpoints. Default search behavior (raw ids, no `_refs`) is unchanged.
