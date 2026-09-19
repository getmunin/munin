---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

Dashboard: the CMS review pane resolves inline `ref://` tokens instead of showing an opaque id.

`GET /v1/cms/drafts/:id` never asked for references, so the pane rendered `[pricing](ref://cme_…)` as an anchor with an unresolvable href — a reviewer could not tell what a link pointed at, or (now that a token resolves per locale) which entry a reader would actually land on. The read and the patch response both carry a `refs` sidecar, and a token renders as a chip naming the target's title, its collection, and the state that matters: **falls back to `<locale>`** when the group has nothing in the entry being reviewed, **missing** when the id resolves to nothing at all. The editor still shows the raw token — that is the thing you edit.

Bare `ref://<id>` tokens outside a markdown link are covered too, via a remark pass that splits them out of text nodes; because it only rewrites `text` nodes it cannot reach inside a code block. react-markdown's URL sanitizer blanks any scheme outside its safe list, so `ref://` needs an explicit `urlTransform` to survive as far as the link renderer — without it the token renders as a plain anchor with an empty href, which looks like nothing is wrong. `text` and `array`-of-`text` fields that opt in with `inlineRefs: true` render through the same markdown path, so the footnote and lead-paragraph fields the flag exists for show their links rather than their ids.

`CmsService.updateEntry` takes an optional `include` so the patch response can carry the same sidecar as the read; the `cms_update_entry` tool surface is unchanged.
