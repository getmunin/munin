---
title: 'CMS: Localize an entry'
description: Configure locales, author one entry per language with its own slug, keep the locale variants linked, and switch the org's default locale without breaking already-published entries.
audiences: [admin]
---

# Localize an entry
Locales are org-scoped. Every entry stores its `locale` as a string column; if the locale is omitted on create, the org's default locale is used. There is **no automatic translation** — each locale is its own entry row, written by hand or imported.

Each locale variant carries **its own slug**: `varlansering-2026` in `nb` and `spring-launch-2026` in `en` are the same content. What ties them together is the `translationGroupId` on every entry — pass `translationOf` when you create a variant and the group is inherited.

## TL;DR

1. `cms_list_locales` — see what's configured.
2. `cms_create_locale` for each missing language. The first locale added auto-becomes default.
3. Create a base entry: `cms_create_entry` with the default locale.
4. Fan out: one `cms_create_entry` per additional locale, with `translationOf` set to the base entry's id and whatever slug reads best in that language.
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

The response carries a `translationGroupId` — a group of one, so far — and the entry `id` you pass as `translationOf` next.

## Step 4 — fan out per locale

For each additional locale, create a separate entry with `translationOf` set to the base entry's id. Give it the slug a reader of that language would expect; don't transliterate the English one.

```jsonc
{
  "name": "cms_create_entry",
  "arguments": {
    "collection": "blog",
    "slug": "varlansering-2026",
    "locale": "nb",
    "translationOf": "cme_…",
    "data": { "title": "Vårlansering 2026", "body": "..." },
    "status": "draft"
  }
}
```

Slug uniqueness is `(collection, slug, locale)` and translation-group uniqueness is `(group, locale)`, so a group holds at most one entry per language. A second `nb` entry in the same group fails with `cms_translation_conflict`.

`translationOf` may point at *any* entry in the group, not just the first one — they all resolve to the same group.

Translations live in `data` — the field schema is per-collection, so make sure every locale supplies the required fields.

## Step 5 — publish per locale

Use `skill://cms/publish-entry` for each entry. There is **no atomic "publish all locales" tool** — publish each one individually. If the order matters (e.g. you don't want the English version live while the Norwegian one is still missing), publish the secondary locales first and the canonical one last.

## Finding and repairing the links

- `cms_list_entry_translations` with any entry id returns every variant in its group: `{ id, locale, slug, status }` each. This is how you find the Norwegian URL for an English entry, and which locales are still missing.
- `cms_link_translation` moves an entry into another entry's group — for two entries authored separately that should have been linked. It conflicts if the target group already holds that locale.
- `cms_unlink_translation` gives an entry a fresh group of its own, undoing a wrong link. The former siblings keep theirs.

## What the delivery API does

`GET /v1/cms/{orgId}/{collection}/{slug}?locale=nb` matches on **both** slug and locale, so ask for the slug that belongs to the locale you want. A published entry's response includes `_locales: [{ locale, slug }, …]` — every *published* variant in its group — which is what you build `hreflang` tags and a language switcher from. Drafts never appear there.

There is **no server-side locale fallback**: a slug/locale pair with no published row is a `404`, not the default-locale version. That's deliberate — silently serving English under a Norwegian URL is worse than a miss. If you want a fallback, fetch the canonical locale and use its `_locales` to redirect.

## Switching the org's default locale

```jsonc
{ "name": "cms_set_default_locale", "arguments": { "code": "nb" } }
```

This atomically clears `isDefault` on every locale for the org and sets it on the target. The cascade is two-statement, but executes in a single transaction.

**Effect on entries**:
- Existing entries keep their `locale` field — nothing rewrites them.
- New entries created without an explicit `locale` will now inherit `nb` instead of the previous default.
- Nothing about translation groups changes: no locale in a group is privileged, so there is no "canonical row" to migrate.

## What NOT to do

- **Don't try to "translate in place" by changing an entry's `locale` field.** That moves the only copy of the content to another language and breaks any inbound link to the old URL. Create a sibling entry with `translationOf` instead.
- **Don't reuse one slug across locales just to keep them findable.** The group is what links them; a shared slug is now only a stylistic choice (fine for product codes, wrong for prose).
- **Don't forget `translationOf`.** An entry created without it is its own group of one — it renders fine but is invisible to `_locales`, so language switchers won't see it. Repair with `cms_link_translation`.
- **Don't depend on entries from a deleted locale.** There's no built-in cleanup; entries with a `locale` that no longer exists in `cms_list_locales` are still in the table but won't be served by the locale-aware delivery API.
- **Don't switch the default locale during a release window.** New entries authored *after* the switch will land in the new default; if a publishing job partly ran under the old default and finished under the new one, you'll have a confusing mix.

## Related

- `skill://cms/publish-entry` — publishing each per-locale entry.
- `skill://cms/migrate-content` — bulk copying entries between locales.
