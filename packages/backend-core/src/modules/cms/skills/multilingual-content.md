---
title: Multilingual CMS content
description: Configure locales, author entries per language, and switch the org's default locale without breaking already-published entries.
audiences: [admin]
---

# Multilingual CMS content

Locales are org-scoped. Every entry stores its `locale` as a string column; if the locale is omitted on create, the org's default locale is used. There is **no automatic translation** — each locale is its own entry row, written by hand or imported.

## TL;DR

1. `cms_list_locales` — see what's configured.
2. `cms_create_locale` for each missing language. The first locale added auto-becomes default.
3. Create a base entry: `cms_create_entry` with the default locale.
4. Fan out: one `cms_create_entry` per additional locale, with the same `slug`.
5. Publish each per-locale entry independently.

## Step 1 — verify locales

```jsonc
{ "name": "cms_list_locales", "arguments": {} }
```

Returns `[{ code, name, isDefault }, ...]`. Codes are ISO 639-1 (`en`, `nb`) or BCP-47 (`en-GB`, `nb-NO`).

## Step 2 — add missing locales

```jsonc
{
  "name": "cms_create_locale",
  "arguments": { "code": "nb", "name": "Norsk bokmål", "isDefault": false }
}
```

If `isDefault: true`, the call atomically clears `isDefault` on every other locale for this org. The very first locale you create is implicitly the default regardless of the flag.

## Step 3 — author the base entry

Pick the default locale (or whichever you treat as canonical). Create the entry once:

```jsonc
{
  "name": "cms_create_entry",
  "arguments": {
    "collection": "blog",
    "slug": "spring-launch-2026",
    "locale": "en",
    "data": { "title": "Spring Launch 2026", "body": "..." },
    "status": "draft"
  }
}
```

## Step 4 — fan out per locale

For each additional locale, create a separate entry with the **same `slug`** and the new `locale`. Slug uniqueness in CMS is `(collection, slug, locale)`, so this is allowed.

```jsonc
{
  "name": "cms_create_entry",
  "arguments": {
    "collection": "blog",
    "slug": "spring-launch-2026",
    "locale": "nb",
    "data": { "title": "Vårlansering 2026", "body": "..." },
    "status": "draft"
  }
}
```

Repeat for each locale. Translations live in `data` — the field schema is per-collection, so make sure every locale supplies the required fields.

## Step 5 — publish per locale

Use `skill://cms/entry-publish-workflow` for each entry. There is **no atomic "publish all locales" tool** — publish each one individually. If the order matters (e.g. you don't want the English version live while the Norwegian one is still missing), publish the secondary locales first and the canonical one last.

## Switching the org's default locale

```jsonc
{ "name": "cms_set_default_locale", "arguments": { "code": "nb" } }
```

This atomically clears `isDefault` on every locale for the org and sets it on the target. The cascade is two-statement, but executes in a single transaction.

**Effect on entries**:
- Existing entries keep their `locale` field — nothing rewrites them.
- New entries created without an explicit `locale` will now inherit `nb` instead of the previous default.
- Public delivery API: locale fallback (per request) follows the new default if the requested locale is missing.

## What NOT to do

- **Don't try to "translate in place" by changing an entry's `locale` field.** That orphans the slug-pair you started with and silently breaks any inbound link. Create a sibling entry instead.
- **Don't depend on entries from a deleted locale.** There's no built-in cleanup; entries with a `locale` that no longer exists in `cms_list_locales` are still in the table but won't be served by the locale-aware delivery API.
- **Don't switch the default locale during a release window.** New entries authored *after* the switch will land in the new default; if a publishing job partly ran under the old default and finished under the new one, you'll have a confusing mix.

## Related

- `skill://cms/entry-publish-workflow` — publishing each per-locale entry.
- `skill://cms/content-migration` — bulk copying entries between locales.
