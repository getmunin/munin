---
'@getmunin/backend-core': minor
---

Let agents revise a CMS entry without resending the whole article.

`cms_update_entry` gains `textReplacements`: an ordered, all-or-nothing list of `{ field, oldText, newText, replaceAll? }` edits applied to the stored text of a `text`, `markdown`, `rich_text`, array-of-text or `blocks` field. Each `oldText` must match exactly once (or set `replaceAll`); zero matches fails with `cms_replacement_no_match`, several with `cms_replacement_ambiguous`, and nothing is written. On a `blocks` field the match runs across the prose of every block while never touching block type names, keys or non-text props. Inline images may be quoted either as the stored `asset://` token or as the public URL `cms_get_entry` showed, because the server maps the URL back to the token before matching. A field may appear in `data` or in `textReplacements`, not both. The `/v1/cms/drafts/:id` PATCH accepts the same field.

The shape follows what agent-facing content APIs have converged on — Notion's `update_content` and Anthropic's text editor tool both use exact-match `old_str`/`new_str` with a replace-all switch — and is deliberately two flat optional siblings on the one update tool rather than a `command` discriminator, which is the schema shape strict hosts have rejected.

Entry-returning write tools take `responseFormat: "full" | "summary"`. `summary` is the `cms_list_entries` shape (long text shortened to a lead with a word count in `fieldSummary`). Create, update and restore default to `full`; publish, unpublish and schedule default to `summary` because they do not change content. `cms_get_entry` takes `fields` to return only the named data keys.

Skills: new `skill://cms/revise-entry`; `publish-entry`, `upload-asset-and-embed`, `migrate-content` and `author-with-blocks` now show the replacement flow.
