---
title: 'CMS: Revise an existing entry'
description: Edit a live or draft article in place — reword a sentence, swap an image, add or remove a block — without regenerating the whole body, then preview and publish the change.
audiences: [admin]
---

# Revise an existing entry

Authoring an article and revising one are different jobs. When you write a new entry you produce the whole body once. When you revise, most of the body is already right, and rewriting it to change one sentence is slow, expensive, and risky — a regenerated body drifts, drops a paragraph, or mangles an `asset://` token. `cms_update_entry` therefore takes two surgical inputs alongside `data`:

- **`textReplacements`** — exact find-and-replace edits inside a field's stored text, the same way a code editor edits a file.
- **`blockEdits`** — add, replace, remove and reorder individual blocks of a `blocks` field by their key.

Reach for the first to change what the text says, the second to change which blocks exist. Both can ride on one call.

## TL;DR

1. `cms_get_entry` — read the entry and hold on to `version`.
2. `cms_update_entry` with `ifVersion` — `textReplacements` to reword, `blockEdits` to restructure, `data` for short fields you replace whole.
3. `cms_get_preview_link` if a human should see it before it goes live (`skill://cms/preview-entry`).
4. `cms_publish_entry` if the entry was a draft. A published entry is live the moment the update lands.

## Step 1 — read the entry

```jsonc
{ "name": "cms_get_entry", "arguments": { "id": "<entryId>" } }
```

You need the current text to quote it exactly, so read the field you are editing in full. If you only need to confirm a title, status or version, pass `fields` and skip the body:

```jsonc
{ "name": "cms_get_entry", "arguments": { "id": "<entryId>", "fields": ["title", "dek"] } }
```

## Step 2 — replace text in place

```jsonc
{
  "name": "cms_update_entry",
  "arguments": {
    "id": "<entryId>",
    "ifVersion": 7,
    "textReplacements": [
      { "field": "body", "oldText": "We ship every tuesday.", "newText": "We ship every Tuesday." },
      { "field": "body", "oldText": "## Pricing\n\nPlans start at $10.", "newText": "## Pricing\n\nPlans start at $12." },
      { "field": "dek", "oldText": "$10", "newText": "$12" }
    ]
  }
}
```

Rules the server enforces:

- **`oldText` must match the stored text exactly**, whitespace and punctuation included, and it must occur **exactly once** in that field. Zero matches fails with `cms_replacement_no_match`; several matches fail with `cms_replacement_ambiguous`. Widen the quote until it is unique, or set `"replaceAll": true` to change every occurrence (a renamed product, a changed year).
- **Edits apply in order, all or nothing.** A later edit sees the result of an earlier one. If any edit fails, nothing is written and `version` does not move.
- **A field is sent one way or the other.** Put a field in `textReplacements` or in `data`, never both in the same call. Use `data` for short fields you are replacing whole (`category`, `read_time_minutes`) and for anything that is not text.
- **Blocks are searched as one body.** On a `blocks` field, `field` is the blocks field itself and the match runs across the prose of every block — a `lead`, a `prose` markdown block, a `pull_quote`. Block type names, keys and non-text props are never matched, so `oldText: "prose"` finds the word in your copy, not the block type. Replacing a whole paragraph is one edit whose `oldText` is that block's full text. To add, remove or reorder a block rather than reword one, use `blockEdits` below.
- **Inline images can be quoted as you saw them.** `cms_get_entry` shows inline images as public URLs; the stored text holds `asset://<id>`. Either form works in `oldText` and `newText` — the server maps the URL back to the token before matching, so the image stays tracked.

The response is the updated entry at the new `version`. Pass `"responseFormat": "summary"` when you do not need the body echoed back — in a long editing session the echo is the biggest cost — and read the summary's `fieldSummary` to confirm the word count moved the way you expected.

### Inserting and deleting

There is no separate insert operation because a replacement already does it. To insert after a paragraph, quote the paragraph and give it back with the new text appended:

```jsonc
{
  "field": "body",
  "oldText": "That is the whole argument.",
  "newText": "That is the whole argument.\n\nOne caveat: it only holds for teams that already ship weekly."
}
```

To delete, make `newText` an empty string. To insert an image between two paragraphs, quote the end of the first and append the image line (`skill://cms/upload-asset-and-embed`).

## Step 2b — add, remove or reorder blocks

`textReplacements` reword what a block says. `blockEdits` change which blocks exist and in what order, addressing them by their stable `key`:

```jsonc
{
  "name": "cms_update_entry",
  "arguments": {
    "id": "<entryId>",
    "ifVersion": 7,
    "blockEdits": [
      { "field": "body", "op": "set", "key": "caveat", "block": { "type": "callout", "props": { "tone": "warn", "body": "Pricing changed in May." } }, "after": "pricing" },
      { "field": "body", "op": "delete", "key": "stale-aside" },
      { "field": "body", "op": "move", "key": "takeaways", "position": "end" }
    ]
  }
}
```

- **`set`** replaces the block with that key, or inserts it when the key is new. `block` is the whole block — `type` plus every prop — and replaces the old one outright rather than merging. Omit `key` to insert under a minted one.
- **`delete`** removes the block with that key.
- **`move`** repositions it, and requires one of `before`, `after` or `position`.

`before` and `after` name another block's key, `position` is `"start"` or `"end"`, and at most one of the three goes on any edit. Edits apply in order and all-or-nothing: insert a block and then move it in the same call, and if any edit fails nothing is written. An unknown key fails with `cms_block_not_found`; two blocks sharing the addressed key fail with `cms_block_ambiguous`.

Both kinds of edit can ride on one call. Block edits run first, so a text replacement in the same call sees the blocks you just inserted. That also means an `oldText` matching both an old block and a newly inserted one becomes ambiguous — quote enough context to stay unique.

### When a whole-field rewrite is the right call

If most of a field is changing — a rewritten introduction, a translated body, a restructured argument — send the new value in `data` instead. `textReplacements` earns its keep when the edit is small relative to the field; a replacement whose `oldText` is 90% of the body saves nothing. The same goes for a blocks field being rebuilt from scratch: past a handful of `blockEdits`, send the array.

## Step 3 — preview, then publish

A draft stays a draft until you publish it. A published entry goes live with the update, so for anything beyond a typo on a live article consider unpublishing first, or making the edit on a draft copy and swapping.

```jsonc
{ "name": "cms_publish_entry", "arguments": { "id": "<entryId>", "ifVersion": 8 } }
```

Publish, unpublish and schedule return a summary by default because they do not change content; pass `"responseFormat": "full"` if you need the body back.

## Recovering

- **`cms_version_conflict`** — someone wrote between your read and your write. Re-read with `cms_get_entry`, check your `oldText` still matches, and retry with the new `version`.
- **`cms_replacement_no_match`** — you are quoting text that is not there. The usual causes are a paraphrase instead of a copy, a straight quote where the text has a curly one, or an edit that an earlier edit in the same call already changed. Re-read and copy the passage exactly.
- **A bad edit went live** — `cms_list_versions` then `cms_restore_version` (`skill://cms/publish-entry`, step 4). Every update is a version.

## What NOT to do

- **Don't regenerate the body to change a sentence.** That is what `textReplacements` is for. A regenerated body is a new text that happens to resemble the old one.
- **Don't send the same field in `data` and `textReplacements` or `blockEdits`.** A whole-value replace and a surgical edit of the same field conflict, and the call is rejected. Block edits and text replacements on one field are fine together.
- **Don't reorder blocks by deleting and re-adding them.** `move` keeps the block's key, its props and its asset references intact; a delete-then-set round-trip risks losing props you didn't restate.
- **Don't retry a `no_match` with a guessed variant of the quote.** Read the entry again and copy.
- **Don't edit a `json` field this way.** `json` is opaque; the server refuses text replacements on it.

## Related

- `skill://cms/publish-entry` — versions, optimistic locking, scheduling and rollback.
- `skill://cms/author-with-blocks` — how block bodies are structured, so you know what a replacement can reach.
- `skill://cms/upload-asset-and-embed` — adding or swapping an image in the body.
- `skill://cms/preview-entry` — a signed preview link for a human review before publishing.
