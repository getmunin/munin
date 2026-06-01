---
title: KB: Import knowledge from Google Docs (or any text source)
description: Bulk-load articles into the knowledge base, sized for vector search and FTS to perform well.
audiences: [admin]
public: true
---

# Import knowledge from Google Docs

The knowledge base stores articles in `kb_documents` with both PostgreSQL FTS and HNSW-indexed pgvector embeddings. The way you chunk and label content at import time decides how well agents find it later.

## TL;DR

1. Pick or create a space: `kb_list_spaces` → `kb_create_space` if needed.
2. For each source doc, decide on chunking — whole doc as one article (preferred for short docs) or split by H2 (preferred for >2000 words).
3. Call `kb_create_document` with `title`, `body` (markdown), `tags`.
4. Embeddings are generated server-side asynchronously — search becomes accurate within seconds.

## Step 1 — pick a space

`kb_list_spaces` returns existing spaces. A space is the org-scoped grouping for related docs (e.g. `Product`, `Engineering`, `Public help center`). One space per audience boundary works well; agents searching with `kb_search` can filter to a space.

If none fits: `kb_create_space` with `{ name, slug, description? }`.

## Step 2 — chunking strategy

The vector index works on whole-document embeddings. Chunking too aggressively (one paragraph per article) makes search noisy; not chunking at all (50KB blob) makes retrieval imprecise.

Heuristics:

- **Short doc** (<1500 words, single topic): one article. Title = source title.
- **Medium doc** (1500–4000 words, sections): one article. Trust FTS to find the right span.
- **Long doc** (>4000 words, distinct sections): split by H2 (`## …`). Each section becomes its own article. Title = source title + " — " + section heading.
- **Reference table / FAQ**: one article per Q&A pair. Title = the question.

When in doubt, fewer larger articles beat many tiny ones. A retrieval that returns "the right doc" lets the consuming agent read the full context.

## Step 3 — create

```jsonc
{
  "name": "kb_create_document",
  "arguments": {
    "spaceId": "<spaceId>",
    "title": "Refund policy — international orders",
    "body": "# Refund policy — international orders\n\nWe issue full refunds within 30 days of delivery for...",
    "tags": ["policy", "refunds", "international"],
    "public": false
  }
}
```

- `body` is markdown. Headings, lists, code blocks all preserved for the rendered view.
- `tags` are a flat string array. Don't overuse — 3–5 high-signal tags > 20 weak ones.
- `audiences` is an array of `'admin'` and / or `'self_service'`. Default `['admin']` keeps the doc admin-only; include `'self_service'` to surface it via `kb_search` for end-user agents.

## Step 4 — embeddings

The server enqueues embedding generation immediately. There's no callback; just expect search to return the new doc within a few seconds. If you need to confirm: `kb_search` with a phrase you'd expect to match.

## Bulk import pattern

For a Google Docs folder with N files:

1. Export each as markdown (Google Docs → File → Download → Markdown).
2. Run a script that reads each `.md`, applies the chunking heuristic above, and calls `kb_create_document` per article. Munin's per-org rate limit applies; pace at ~10/sec or use `kb_search` between batches to verify.

## Updating existing docs

Use `kb_update_document` with `{ id, body }` (or `title`, `tags`). Versions are kept automatically — `kb_list_versions` shows history; `kb_restore_version` reverts.

## Common pitfalls

- **Indexing only the first paragraph** (because the model summarizes long docs at ingest time). Munin embeds the whole `body` field. Send the full text.
- **Putting structured data in `metadata` instead of `body`**. FTS and embeddings only see `body` (and `title`). Anything you want findable goes there.
- **Forgetting `tags`**. Tags don't drive search relevance directly but they're the cheapest way for an agent to filter (`kb_search` with `tags: ['policy']`).
