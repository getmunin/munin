---
'@getmunin/backend-core': minor
---

Add, replace, remove and reorder CMS blocks by key without resending the array.

`cms_update_entry` gains `blockEdits`: an ordered, all-or-nothing list of `{ field, op, key?, block?, before?, after?, position? }` operations on a `blocks` field. `set` replaces the block with that key or inserts it when the key is new, `delete` removes one, and `move` repositions one; `before`/`after` name another block's key and `position` is `start` or `end`. A key that is not there fails with `cms_block_not_found`, two blocks sharing an addressed key fail with `cms_block_ambiguous`, and a malformed edit fails with `cms_block_invalid` — in every case nothing is written and the version does not move. Omitting `key` on `set` mints one, so a block can be appended without inventing an identifier.

This completes the editing surface `textReplacements` started: replacements change what a block says, block edits change which blocks exist. Both may appear in one call, block edits first, so an insert and a nearby reword are a single write and a single version. A field still goes in `data` or in the surgical inputs, never both.

`set` replaces a block outright rather than merging its props, which is what makes the operation idempotent and keeps the tool from needing a nested merge semantics of its own. Asset and reference rewiring runs on the resulting array, so a figure block inserted this way is immediately covered by the asset delete guard — `cms_list_asset_usage` reports it and `cms_delete_asset` refuses.

The `/v1/cms/drafts/:id` PATCH accepts the same field. Skills: `author-with-blocks` and `revise-entry` document the operations.
