---
title: 'CMS: Design a collection'
description: Turn "I need a blog / product catalog / FAQ / landing-page content store" into a working `cms_create_collection` call — pick field types deliberately, order fields for the editor, decide localization up front, and avoid the field-migration paper cuts.
audiences: [admin]
---

# Design a collection
A collection is a content type — schema + a table of entries. Designing one well saves a lot of pain later: fields are easy to add, awkward to rename, and never quite painless to remove. Spend the time up front to pick types and locale-awareness deliberately.

Use this when you're about to call `cms_create_collection` for the first time on a new content surface. For *importing* into an existing collection, see `skill://cms/migrate-content` instead.

## TL;DR

1. Decide what the entries represent (one row = ???). If you can't write that sentence, you're not ready.
2. Decide whether entries need localization. This is the one decision that's expensive to reverse.
3. Pick a field type for each piece of data from the catalog below.
4. Order the fields in the sequence a human would fill them in.
5. `cms_create_collection`. Verify with `cms_get_collection`; create one test entry to feel the schema.

## Step 1 — name it

```jsonc
{
  "name": "blog-posts",       // slug — kebab-case, used in URLs and tool calls
  "title": "Blog posts",      // editor-facing label
  "description": "Public-facing articles on the marketing site."
}
```

Slug rules:
- Kebab-case, lowercase, plural noun ("blog-posts", "products", "team-members" — not "post" or "Product").
- Stable. The slug is in the public delivery URL (`/v1/cms/{orgId}/{slug}/...`), in tool calls (`cms_list_entries({collection: 'blog-posts'})`), and in reference field options (`targetCollection: 'authors'`). Changing it later is a rename across all of those, plus any frontend code that hardcodes it.
- Don't include the word "collection" or your tenant name. `blog-posts` not `customer-blog-posts-collection`.

## Step 2 — decide localization

`localized: true` on the collection enables per-locale variants of entries. Each entry then has one `data` blob per locale, and you query with `?locale=…` against the delivery API.

Decide now:

- **Will the same entry need to exist in multiple languages?** (Marketing site copy for EU customers, product descriptions for international retail, KB articles in en + ja + de.) → `localized: true`.
- **Is each entry inherently single-language?** (User-generated reviews, internal-only changelog notes, content that gets *re-authored* per market rather than translated.) → leave it false.

You can flip a collection from non-localized to localized later, but only the "default locale" entries get auto-populated — anything else needs backfill. Going from localized to non-localized loses data.

Individual fields can also opt out of localization with `localized: false` on the field (e.g. a `publishedAt` datetime doesn't translate). Default behavior when the collection is localized: every field is localized unless you say otherwise.

## Step 3 — pick field types

Fourteen types. Pick by intent, not by "what's most flexible."

| Type | When to use | Editor renders as | Stored as |
|---|---|---|---|
| `text` | Single-line text. Titles, names, short labels. | `<input type="text">` | string |
| `rich_text` | Multi-line prose with formatting (bold, italic, links, headings). | Lexical / Tiptap-style editor. | structured JSON (rendered by your frontend) |
| `markdown` | Multi-line prose authored as markdown. | Textarea with preview. | string (markdown source) |
| `number` | Decimals — prices, ratings, durations. | `<input type="number">` | number |
| `integer` | Whole counts — quantities, ranks, ids from external systems. | Same input; stricter validation. | integer |
| `boolean` | On/off flags — `featured`, `archived`, `acceptsComments`. | Toggle. | boolean |
| `date` | Calendar date with no time. `YYYY-MM-DD`. | Date picker. | string |
| `datetime` | Moment in time. ISO 8601. | Datetime picker. | string |
| `select` | One choice from a fixed list — `status`, `category`. | Dropdown. | string (one of `options.choices`) |
| `multi_select` | Many choices from a fixed list — `tags`, `audiences`. | Multi-checkbox. | string[] |
| `asset` | Image / file uploaded via `cms_request_asset_upload` or `cms_upload_asset_from_url`. | Asset picker with preview. | asset id (string) |
| `reference` | Pointer to an entry in another collection (or this one) — `author`, `category`, `relatedPosts`. | Entry picker scoped to `options.targetCollection`. | entry id (string) |
| `array` | Repeating list of a single sub-type — `gallery: array<asset>`, `bulletPoints: array<text>`. | Reorderable list of the sub-type's editor. | array of the sub-type |
| `json` | Escape hatch — arbitrary structured data with no validation. | Raw JSON editor. | any |

Reach for `json` only when you'd otherwise be cramming structured data into a `text` field with comments like "format: foo;bar;baz". If you find yourself doing that, you probably want a small array-of-references or array-of-text instead.

`rich_text` vs `markdown`: pick `markdown` if a human is comfortable writing markdown OR you need to round-trip the source (e.g. imported from a markdown file). Pick `rich_text` if non-technical authors will use the editor and the output goes into a renderer you control. Don't mix both in the same collection unless you really mean to.

### Field options shape

```jsonc
{
  "name": "category",
  "type": "select",
  "required": true,
  "options": { "choices": ["news", "tutorial", "release-notes"] }
}
```

```jsonc
{
  "name": "author",
  "type": "reference",
  "required": true,
  "options": { "targetCollection": "authors" }
}
```

```jsonc
{
  "name": "gallery",
  "type": "array",
  "options": { "items": { "name": "image", "type": "asset" } }
}
```

```jsonc
{
  "name": "relatedPosts",
  "type": "array",
  "options": {
    "items": {
      "name": "post",
      "type": "reference",
      "options": { "targetCollection": "blog-posts" }
    }
  }
}
```

## Step 4 — order fields for the editor

**Field order in the `fields` array is the render order in editors and public surfaces.** Order matters. Order the way a human would fill out the form, lede-first:

1. Hero / cover image (`asset`).
2. Headline (`text`).
3. Excerpt or summary (`text` or `markdown`).
4. Metadata that affects publishing (`status`, `category`, `featured`, `publishedAt`).
5. Body content (`rich_text` or `markdown`).
6. Optional / trailing fields (SEO overrides, internal notes, custom JSON).

If you're not sure where a field goes: would a journalist write it first or fact-check it last? First → high. Last → low.

You can reorder later via `cms_update_collection`, but every editor will see the new order — coordinate if real authors are mid-draft.

## Step 5 — required vs optional

`required: true` makes the field mandatory at *publish* time (drafts can omit it). Mark as required only if entries are genuinely incomplete without it. Over-requiring early is annoying; you can't drop a required-flag without surveying existing entries.

For genuinely optional fields, omit `required` rather than setting `required: false` (both work; omission is the conventional shape in this codebase).

## Step 6 — descriptions

Every field accepts a `description` (max 500 chars) that shows up in the editor as helper text. Use it for:

- Format hints not enforceable by type (`"Used as the URL slug — letters, digits, hyphens only"`).
- Length / dimension guidance (`"Recommended 1600×900, max 2MB"`).
- What the field does and doesn't do (`"Falls back to the global site title if empty"`).

Skip descriptions for fields whose name + type are self-explanatory (`title: text`, `publishedAt: datetime`).

## Step 7 — create it

```jsonc
{
  "name": "cms_create_collection",
  "arguments": {
    "name": "Blog posts",
    "slug": "blog-posts",
    "description": "Public-facing articles on the marketing site.",
    "localized": true,
    "fields": [
      { "name": "coverImage", "type": "asset",
        "description": "16:9 hero image at the top of the article. Recommended 1600×900." },
      { "name": "title", "type": "text", "required": true },
      { "name": "slug", "type": "text", "required": true, "localized": false,
        "description": "URL slug — kebab-case, ASCII only. Identical across locales." },
      { "name": "excerpt", "type": "text",
        "description": "1–2 sentences, shown in list views and meta descriptions." },
      { "name": "author", "type": "reference", "required": true, "localized": false,
        "options": { "targetCollection": "authors" } },
      { "name": "category", "type": "select", "required": true, "localized": false,
        "options": { "choices": ["news", "tutorial", "release-notes"] } },
      { "name": "tags", "type": "multi_select", "localized": false,
        "options": { "choices": ["frontend", "backend", "ai", "ops"] } },
      { "name": "publishedAt", "type": "datetime", "localized": false },
      { "name": "body", "type": "markdown", "required": true },
      { "name": "seoTitleOverride", "type": "text",
        "description": "Optional — defaults to `title` if empty." }
    ]
  }
}
```

Then sanity-check:

```jsonc
{ "name": "cms_get_collection", "arguments": { "idOrSlug": "blog-posts" } }
```

Create one entry by hand and confirm the editor experience matches your intent before scripting any bulk import (`skill://cms/migrate-content`).

## Reference fields: the two-pass setup

When collection A references collection B and B references A back (blog posts → author, author → featured-posts), neither can be created first with both fields populated. The convention:

1. Create both collections without the cross-reference fields.
2. `cms_update_collection` on each, adding the reference field.

Or accept one direction as canonical (blog post → author) and skip the back-reference; query the inverse direction at runtime via `cms_list_inbound_references`.

## Common collection archetypes

These are sketches — fill in fields specific to your content.

**Blog / article** — `coverImage` (asset), `title` (text), `slug` (text, non-localized), `excerpt` (text), `author` (reference→authors), `category` (select), `tags` (multi_select), `publishedAt` (datetime), `body` (markdown or rich_text).

**Author / team member** — `avatar` (asset), `name` (text), `slug` (text, non-localized), `role` (text), `bio` (markdown), `socialLinks` (json or array<text>).

**Product** — `images` (array<asset>), `name` (text), `sku` (text, non-localized), `priceCents` (integer), `currency` (select), `inStock` (boolean), `category` (reference→product-categories), `description` (rich_text), `specifications` (json).

**FAQ / help article** — `question` (text), `slug` (text, non-localized), `category` (reference→faq-categories), `answer` (markdown), `relatedArticles` (array<reference→faq>).

**Landing-page section / block** — `heading` (text), `subheading` (text), `media` (asset), `body` (markdown), `cta` (json with `{label, href}`), `theme` (select with `["light", "dark", "accent"]`).

## Field migration semantics (read this before updating)

`cms_update_collection` with `fields` **replaces the array entirely**. Whatever you pass is the new schema; anything you omit is dropped.

- **Adding a field**: safe. New entries get the default (or null); existing entries return null for that field until edited.
- **Removing a field**: lossy. The data stays in the entry's `data` jsonb but stops being read by the projection layer and stops appearing in delivery API responses. To truly remove, you'd need to clean the jsonb in a one-off SQL pass.
- **Renaming a field**: catastrophic by default — drop + add = data orphaned. There's no automatic migration. Workaround: add the new name, run a script to copy values, then drop the old name.
- **Changing a field's type**: same as rename. Type-coerce values in your migration step before flipping the schema.

The dashboard editor will warn before destructive changes; if you're driving this through MCP, the tool won't — you're on your own.

## What NOT to do

- **Don't make every metadata field a separate reference collection.** It's tempting (normalize all the things), but a single `select` with `["news", "tutorial", "release-notes"]` is faster to read, faster to render, and one fewer collection to maintain. Reach for `reference` when the related thing has its own editor surface (an author has a bio and an avatar; a category is just a label).
- **Don't use `json` as a "we'll figure it out later" field.** It bypasses validation, doesn't get search-indexed, and the editor renders raw JSON. Use specific types for as much structure as you can name.
- **Don't put HTML in `text` fields.** Use `rich_text` (structured) or `markdown` (source). Raw HTML in a string field means every consumer has to sanitize.
- **Don't skip `slug` non-localization for fundamentally non-translatable fields.** A blog post's URL slug should be the same across locales (or different by deliberate choice); a `publishedAt` timestamp doesn't change between en and ja. Mark these `localized: false` on the field even when the collection is localized.
- **Don't reuse a collection for "kind of similar" content.** Two collections with 80% overlap is fine and easy to evolve. One collection with a `type` discriminator and a bunch of conditionally-populated fields is hard to evolve and hard to query.

## Related

- `skill://cms/publish-entry` — once the schema exists and you start populating entries.
- `skill://cms/migrate-content` — bulk-import into the new collection.
- `skill://cms/localize-entry` — adding locale variants to a localized collection.
- `skill://cms/upload-asset-and-embed` — wiring up the `asset` field type end-to-end.
- `skill://cms/review-stale-entries` — operational pass once the collection is in production.
