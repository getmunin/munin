---
title: Create the first knowledge-base space
description: Stand up a fresh org's knowledge base — pick a space taxonomy, create the first space, optionally seed a welcome doc.
audiences: [admin]
---

# Create the first knowledge-base space
A new org has zero KB spaces. Before the team can write articles or an agent can call `kb_search`, at least one space must exist.

## TL;DR

1. `kb_list_spaces` — see whether a space already exists.
2. If empty: `kb_create_space({ name, slug, description? })`.
3. (Optional) `kb_create_document({ spaceId, title, body, audiences })` to seed a welcome doc.
4. Hand off to `skill://kb/import-articles-in-bulk` or `skill://kb/import-from-google-docs` for content.

## Step 1 — check current state

```jsonc
{ "name": "kb_list_spaces", "arguments": {} }
```

If a space already exists, skip to step 3 or stop — the org is onboarded.

## Step 2 — create the first space

The space is the namespace agents and humans search within. Slug must be globally unique within the org (lowercase, digits, hyphens, 1–64 chars).

Pick a name + slug that match the audience boundary:
- **`product` / `Product`** — internal: how the product works, internal runbooks, postmortems.
- **`help` / `Help center`** — public: end-user-facing FAQs and guides.
- **`engineering` / `Engineering`** — internal: code conventions, architecture, on-call docs.

```jsonc
{
  "name": "kb_create_space",
  "arguments": { "name": "Help center", "slug": "help" }
}
```

If creation rejects the slug, it's almost always uniqueness — try a more specific slug (`acme-help` rather than `help`).

## Step 3 — optional welcome doc

```jsonc
{
  "name": "kb_create_document",
  "arguments": {
    "spaceId": "<space-id-from-step-2>",
    "title": "How we work",
    "body": "... markdown ...",
    "audiences": ["admin"]
  }
}
```

The body is markdown; chunking and tagging guidance lives in `skill://kb/import-from-google-docs`.

## Step 4 — onward

For more spaces, call `kb_create_space` again. For bulk content seeding, follow:

- `skill://kb/import-from-google-docs` — chunking strategy, embedding behavior, FTS performance.
- `skill://kb/import-articles-in-bulk` — generalized CSV/JSON pipeline.

## What NOT to do

- **Don't create a "default" or "general" space.** Spaces are search-filterable; agents will conflate everything if there's only one. Pick a real audience boundary.
- **Don't skip the slug discussion.** Slugs are user-visible (in URLs, in agent search filters) and changing them later is awkward — `kb_create_space` doesn't have an "update slug" tool.
- **Don't import content before the space exists.** `kb_create_document` requires a `spaceId`; bulk loops fail loudly without it.

## Related

- `skill://kb/import-from-google-docs` — chunking + embeddings deep-dive.
- `skill://kb/import-articles-in-bulk` — generalized bulk pipeline.
