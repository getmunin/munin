---
'@getmunin/backend-core': minor
---

CMS: entry lists return summaries, so a list call can no longer blow the host's result cap.

`cms_list_entries` ran every row through the same projection as `cms_get_entry`, so listing a collection of articles returned every full body. On a real collection, `{ collection: "journal-blocks", limit: 100 }` produced 72,768 characters — over Claude Desktop's per-result cap, which spilled the payload to a file and left the calling agent with nothing usable. `cms_search` had the same shape: full `data` on up to 50 hits, redundant with the match excerpt it already returned.

Both now summarize. Because collection schemas are user-defined, the projection is driven by value size rather than a per-collection config: short values (text, numbers, booleans, dates, selects, asset/reference ids) come back verbatim, long text is shortened to a ~200-character lead, and oversized collections are replaced by an item count. What was withheld is reported per field in `fieldSummary` — `{ "body": { "words": 1600, "truncated": true } }` — so a length signal survives without the bytes. A result-wide budget sheds lead length in stages and, as a last resort, drops rows, reported as `dropped` rather than silently truncated.

Breaking changes to two tool result shapes:

- `cms_list_entries` returns `{ entries, returned, dropped, truncated }` instead of a bare array, and each entry gains `title`, `titleFieldName`, `fieldSummary`, and `truncated`. It no longer expands asset fields or accepts `include` — summaries never expand. `cms_get_entry` (unchanged) and the public delivery API remain the full-fidelity reads.
- `cms_search` hits carry summarized `data` plus `title`, `fieldSummary`, and `truncated`. `include: ["references"]` still works: expanded references keep their `{ id, slug, collection, locale }` identity and their nested `data` is summarized in turn. The public delivery API's search is untouched and still returns full entry data for frontends.

New inputs on `cms_list_entries`: `ids` reads up to 50 specific entries in one widget-free call — the shape a research pass over several entries actually wants, instead of N `cms_get_entry` calls each rendering an MCP Apps panel — and `fields` returns named fields verbatim when the full value is the point.

Also fixes a latent 500 found while testing this: `cms_create_entry` and `cms_update_entry` had no duplicate pre-check against `cms_entries_slug_uq`, so reusing a slug in a collection poisoned the request transaction and failed at commit, past any handler-level catch, surfacing as a bare `500`. Both now pre-check and raise `cms_slug_conflict`.
