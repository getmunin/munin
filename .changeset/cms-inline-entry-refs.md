---
"@getmunin/backend-core": minor
---

CMS: inline entry references (`ref://<entryId>`). Authors can link or embed another entry from within prose (a markdown/rich_text field or a block prop) with a `ref://<entryId>` token. Under `?include=references` (delivery API) or `include: ["references"]` (`cms_get_entry` / `cms_list_entries`), the response carries a `_refs` map keyed by entry id → `{ id, slug, collection, locale, data }`. Unlike `asset://`, the token is intentionally left in place (the server doesn't know the consumer's routing); the frontend resolves it via `_refs` to build its own link or embed.
