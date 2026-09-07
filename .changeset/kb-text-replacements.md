---
'@getmunin/backend-core': minor
---

Let agents revise a knowledge-base document without resending the whole body.

`kb_update_document` gains `textReplacements`: an ordered, all-or-nothing list of `{ oldText, newText, replaceAll? }` edits applied to the stored body — the same contract `cms_update_entry` uses, sharing its implementation. Each `oldText` must match exactly once (or set `replaceAll`); zero matches fails with `kb_replacement_no_match`, several with `kb_replacement_ambiguous`, and nothing is written. `body` and `textReplacements` are alternatives and cannot be combined in one call. The `/v1/kb/candidates/:id` PATCH accepts the same field, and `KbInvalidError` now carries a machine-readable `code` through to the control plane.

`kb_create_document`, `kb_update_document`, `kb_restore_version` and `kb_publish_curation_revision` take `responseFormat: "full" | "summary"`, defaulting to `full`. `summary` shortens the body to a lead and reports its word count in `bodySummary`, so a bulk import or a long editing session does not echo every body back into the agent's context.

`kb_propose_curation_revision` deliberately still takes the full proposed body: the reviewer sees it as a diff against the current document.

Skills: new `skill://kb/revise-document`; `import-from-google-docs` and `review-content` now point at the replacement flow for small edits.
