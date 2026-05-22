---
title: Import articles in bulk from CSV or JSON
description: Generalized bulk import pipeline for KB articles from any structured source. Companion to import-from-google-docs — that one covers chunking; this one covers source handling and idempotency.
audiences: [admin]
---

# Import articles in bulk from CSV or JSON
Import a list of articles into the knowledge base from any structured source — CSV export, JSON dump, scraped help-center pages. The hard part isn't calling `kb_create_document`; it's making the import idempotent so a partial run can resume, and applying the right chunking so search performs well later.

> **Read first:** `skill://kb/import-from-google-docs` covers the chunking strategy (whole-doc vs split-by-H2), tagging conventions, and what the embedding pipeline actually does. This skill assumes you've absorbed that and focuses on the source-format and idempotency layers.

## TL;DR

1. Pick or create the target space (`kb_list_spaces` / `kb_create_space`).
2. Validate the source: required columns/keys are `title` + `body`; `tags` and `public` are optional.
3. Decide an idempotency key (an external id you put into a tag like `import:<source-id>`).
4. For each row: `kb_search` for the import key tag → if hit, skip; otherwise apply chunking and `kb_create_document`.
5. Spot-check with `kb_search` on a known phrase to confirm embeddings are indexed.

## Step 1 — pick the space

```jsonc
{ "name": "kb_list_spaces", "arguments": {} }
```

If none fits the source's audience, `kb_create_space` first (or guide through `skill://kb/create-first-space`).

## Step 2 — validate the source

For CSV:
- Required: `title` (≤300 chars), `body` (markdown, non-empty).
- Optional: `tags` (comma-separated → array, ≤32 entries, each ≤64 chars), `public` (boolean → defaults to `false`).
- Watch out for: quoted fields containing newlines, escaped commas inside `tags`, smart-quote / em-dash artifacts from copy-paste.

For JSON:
- Same fields. Arrays-of-objects is the easiest shape. Reject anything that doesn't have at least `title` + `body`.

If `body` is HTML rather than markdown, convert before submission — the KB's renderer expects markdown. (Use a known converter; don't roll your own.)

## Step 3 — idempotency key

There is no built-in "external id" field on `kb_documents`. Use a **tag** as the key:

```
tags: ["import:<source-id>", ...other tags]
```

Where `<source-id>` is the source system's stable id (Zendesk article id, Confluence page id, row index in the CSV).

Before creating, check whether the import key already exists:

```jsonc
{ "name": "kb_search", "arguments": { "query": "import:<source-id>", "limit": 3 } }
```

`kb_search` is full-text + semantic — exact-string matches surface in the FTS layer reliably, especially for an unusual prefix like `import:`. If the search returns the same article, **update is not supported via tags** — you'd need to delete and recreate, or skip. For most imports, idempotency means "skip if exists".

## Step 4 — chunk + create

Apply the chunking rules from `skill://kb/import-from-google-docs`:
- ≤2000 words → one document, whole-doc as body.
- >2000 words → split by H2 headings, one document per section, each tagged with the source title so they cluster.

For each chunk:

```jsonc
{
  "name": "kb_create_document",
  "arguments": {
    "spaceId": "<spaceId>",
    "title": "<chunk title>",
    "body": "<markdown body>",
    "tags": ["import:<source-id>", "<source-name>", "<topic-tag>"],
    "public": false
  }
}
```

Default `audiences: ['admin']` unless the source is explicitly customer-facing material. End-user agents only see docs whose `audiences` includes `'self_service'`. Embeddings are generated server-side asynchronously — you don't wait, but search results for new docs become accurate within ~5 seconds.

Pace: a few documents per second is fine. If you're importing thousands of rows, throttle to leave room for other traffic.

## Step 5 — verify

After the loop, spot-check with a known phrase from the source:

```jsonc
{ "name": "kb_search", "arguments": { "query": "<distinctive phrase>", "limit": 5 } }
```

Then count: search by the import-tag prefix and confirm the count matches your source row count (minus skips).

## What NOT to do

- **Don't ignore `kb_create_document` errors.** Title-too-long and empty-body errors are common in CSV exports; logging them per-row lets you fix the source data and re-run.
- **Don't import with `audiences: ['admin', 'self_service']` by default.** That exposes content to end-user agents via `kb_search`. Only include `'self_service'` for explicitly customer-facing knowledge.
- **Don't import the same source twice without the import-tag idempotency key.** Duplicate articles dilute search quality and confuse end-users.
- **Don't set hundreds of identical tags across the import.** Tags are filterable; that means each tag is part of someone's mental model. Use tags as facets, not as labels.

## Related

- `skill://kb/import-from-google-docs` — chunking + embedding details (read first).
- `skill://kb/create-first-space` — creating the space if you don't have one.
