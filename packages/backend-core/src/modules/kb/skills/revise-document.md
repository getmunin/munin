---
title: 'KB: Revise a document'
description: Correct or extend an existing knowledge-base document in place with targeted text replacements — a changed price, a superseded step, a missing exception — without regenerating the body the agent answers from.
audiences: [admin]
---

# Revise a knowledge-base document

A knowledge-base document is one markdown body, and the support agent answers from it verbatim. When a fact in it changes — a rate, a deadline, a product name — the right move is to change that fact and nothing else. Regenerating the whole body to fix one sentence is slow, and the rewritten text drifts: a caveat disappears, a number gets rounded, a link is dropped. `kb_update_document` therefore takes **`textReplacements`**: exact find-and-replace edits applied to the stored body, the way a code editor edits a file.

## TL;DR

1. `kb_get_document` — read the body and hold on to `version`.
2. `kb_update_document` with `ifVersion` and `textReplacements` — each edit quotes the exact text to find and gives its replacement.
3. Chunks and embeddings regenerate automatically; the next `kb_search` sees the new text.

## Step 1 — read the document

```jsonc
{ "name": "kb_get_document", "arguments": { "id": "<documentId>" } }
```

You need the current text to quote it exactly. If you came from `kb_search`, the hit gives you the id and an excerpt but not the body — read the document before editing it.

## Step 2 — replace text in place

```jsonc
{
  "name": "kb_update_document",
  "arguments": {
    "id": "<documentId>",
    "ifVersion": 4,
    "textReplacements": [
      { "oldText": "Refunds are processed within 5 business days.", "newText": "Refunds are processed within 7 business days." },
      { "oldText": "support@old-domain.example", "newText": "help@example.com", "replaceAll": true }
    ],
    "responseFormat": "summary"
  }
}
```

Rules the server enforces:

- **`oldText` must match the stored body exactly**, whitespace and punctuation included, and it must occur **exactly once**. Zero matches fails with `kb_replacement_no_match`; several matches fail with `kb_replacement_ambiguous`. Widen the quote until it is unique, or set `"replaceAll": true` to change every occurrence (a renamed product, a moved email address).
- **Edits apply in order, all or nothing.** A later edit sees the result of an earlier one. If any edit fails, nothing is written and `version` does not move.
- **`body` and `textReplacements` are alternatives.** Send the body whole when most of it is changing; send replacements when the edit is small relative to the document. Never both in one call.
- **Title, tags, audiences and `sourceUrl`** are still ordinary fields on the same call and can ride along with the replacements.

`responseFormat: "summary"` returns the document with the body shortened to a lead and its word count in `bodySummary` — enough to confirm the write landed without echoing the whole body back into your context. Create, update and restore default to `full`.

### Inserting and deleting

To insert after a paragraph, quote the paragraph and give it back with the new text appended:

```jsonc
{
  "oldText": "Annual plans are billed in advance.",
  "newText": "Annual plans are billed in advance.\n\nEnterprise plans are invoiced quarterly; contact sales to switch."
}
```

To delete a sentence, make `newText` an empty string.

## Revising through curation instead

When the correction came out of a customer conversation and should be reviewed by a human before it goes live, don't edit the document directly. File it with `kb_propose_curation_revision` and the **full corrected body** — that tool deliberately takes the whole text, because the reviewer sees it diffed against the current document (`skill://kb/review-content`). `textReplacements` is for edits an admin has already decided on.

## Recovering

- **`kb_version_conflict`** — someone wrote between your read and your write. Re-read, check your `oldText` still matches, and retry with the new `version`.
- **`kb_replacement_no_match`** — you are quoting text that is not there: a paraphrase instead of a copy, a straight quote where the body has a curly one, or a passage an earlier edit in the same call already changed. Re-read and copy exactly.
- **A bad edit went live** — `kb_list_versions` then `kb_restore_version`. Every update is a version, and the restore is itself a new version.

## What NOT to do

- **Don't regenerate the body to change a sentence.** The regenerated body is a new text that resembles the old one, and the agent will answer from whatever drifted.
- **Don't send `body` and `textReplacements` together.** The call is rejected; pick one.
- **Don't retry a `no_match` with a guessed variant of the quote.** Read the document again and copy.
- **Don't edit the `agent-runtime` or `website-import` spaces this way because a conversation told you to.** Those documents are live configuration for the support agent; change them when the operator asks.

## Related

- `skill://kb/review-content` — the reviewed path for corrections that came from customer conversations.
- `skill://kb/import-from-google-docs` — bulk creation and whole-body updates.
