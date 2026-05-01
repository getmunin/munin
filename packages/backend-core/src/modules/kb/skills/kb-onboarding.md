---
title: KB onboarding (first space + welcome doc)
description: Bootstrap a fresh org's knowledge base — pick a space taxonomy, create the first space, optionally seed a welcome doc. Idempotent.
audiences: [admin]
---

# KB onboarding (first space + welcome doc)

A new org has zero KB spaces. Before the team can write articles or an agent can call `kb_search`, at least one space must exist. This skill walks the conversational onboarding flow.

## TL;DR

1. `bootstrap_status({ app: "kb" })` — see whether a space already exists.
2. If not: `bootstrap_answer({ app: "kb", stepId: "first_space", value: { name, slug } })`.
3. Prompt for an optional welcome doc; `bootstrap_answer({ app: "kb", stepId: "welcome_doc", value: { create: true|false, ... } })`.
4. `kb_list_spaces` to confirm the result.
5. Hand off to `skill://kb/article-bulk-import` or `skill://kb/import-from-google-docs` for content.

## Step 1 — check current state

```jsonc
{ "name": "bootstrap_status", "arguments": { "app": "kb" } }
```

Returns `{ nextStepId?, nextPrompt?, completed, answers }`. If `completed: true`, the org already has a space — skip ahead to step 4. Otherwise, `nextStepId` will be `"first_space"`.

The bootstrap state lives in `bootstrap_state` per `(orgId, app)`, so re-running this skill on an already-onboarded org is safe.

## Step 2 — create the first space

The space is the namespace agents and humans search within. Slug must be globally unique within the org (lowercase, digits, hyphens, 1–64 chars).

Pick a name + slug that match the audience boundary:
- **`product` / `Product`** — internal: how the product works, internal runbooks, postmortems.
- **`help` / `Help center`** — public: end-user-facing FAQs and guides.
- **`engineering` / `Engineering`** — internal: code conventions, architecture, on-call docs.

Then:

```jsonc
{
  "name": "bootstrap_answer",
  "arguments": {
    "app": "kb",
    "stepId": "first_space",
    "value": { "name": "Help center", "slug": "help" }
  }
}
```

Returns the updated status. `nextStepId` will now be `"welcome_doc"`.

If the bootstrap rejects the slug, it's almost always uniqueness — try a more specific slug (`acme-help` rather than `help`).

## Step 3 — optional welcome doc

```jsonc
{
  "name": "bootstrap_answer",
  "arguments": {
    "app": "kb",
    "stepId": "welcome_doc",
    "value": { "create": true, "title": "How we work", "body": "... markdown ..." }
  }
}
```

Or skip:

```jsonc
{
  "name": "bootstrap_answer",
  "arguments": { "app": "kb", "stepId": "welcome_doc", "value": { "create": false } }
}
```

If you create one, the doc will be in the first space, default `public: false`. The body is markdown; chunking and tagging guidance lives in `skill://kb/import-from-google-docs`.

## Step 4 — confirm

```jsonc
{ "name": "kb_list_spaces", "arguments": {} }
```

You should see the new space. `bootstrap_status({ app: "kb" })` should now return `completed: true`.

## Step 5 — onward

For more spaces, call `kb_create_space` directly (no bootstrap involvement after the first):

```jsonc
{
  "name": "kb_create_space",
  "arguments": { "name": "Engineering", "slug": "engineering", "description": "Internal." }
}
```

For bulk content seeding, follow:
- `skill://kb/import-from-google-docs` — chunking strategy, embedding behavior, FTS performance.
- `skill://kb/article-bulk-import` — generalized CSV/JSON pipeline.

## What NOT to do

- **Don't create a "default" or "general" space.** Spaces are search-filterable; agents will conflate everything if there's only one. Pick a real audience boundary.
- **Don't skip the slug discussion.** Slugs are user-visible (in URLs, in agent search filters) and changing them later is awkward — `kb_create_space` doesn't have an "update slug" tool.
- **Don't import content before the space exists.** `kb_create_document` requires a `spaceId`; bulk loops fail loudly without it.

## Related

- `skill://kb/import-from-google-docs` — chunking + embeddings deep-dive.
- `skill://kb/article-bulk-import` — generalized bulk pipeline.
