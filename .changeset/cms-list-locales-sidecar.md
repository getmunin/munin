---
'@getmunin/backend-core': minor
---

CMS delivery list responses now carry the `_locales` sidecar

`GET /v1/cms/{orgId}/{collection}` previously omitted `_locales`, which only the
single-entry endpoint returned. Consumers building a sitemap from list calls had no way
to learn an entry's published translation siblings without re-fetching every entry, so
they either skipped `hreflang` alternates entirely or emitted a self-referential
`x-default` — a worse signal to search engines than emitting nothing.

Each item now carries the same `_locales: [{ locale, slug }, …]` shape as the entry
endpoint, resolved for the whole page in a single batched query keyed on
`translation_group_id` (covered by the existing
`cms_entries_translation_group_locale_uq` index), so page size does not multiply the
query count.

Note that `_locales` is emitted whenever the translation group has at least one
published variant, which means an entry with no siblings gets a one-element array
naming itself. That matches the entry endpoint's long-standing behavior. Callers should
require a second locale before generating `hreflang` tags.
