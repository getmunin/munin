---
'@getmunin/backend-core': patch
'@getmunin/db': patch
---

Give every locale variant of a CMS entry its own slug.

`cms_entries` was already unique per `(collection, slug, locale)`, so a Norwegian row with slug `varlansering-2026` next to an English `spring-launch-2026` always stored fine. What blocked it was identity: the shared slug *was* the link between locale variants — `skill://cms/localize-entry` told agents to create siblings with the same slug — so the moment the slugs diverged there was no way to answer "what are the other languages of this entry?". That question drives `hreflang`, language switchers, "which locales are still missing", and any decision about fallback.

Entries now carry `translation_group_id`. Variants share it, `(org, group, locale)` is unique, and no locale in a group is privileged — which matters because `cms_set_default_locale` can flip the default at any time, and a parent/child model would have made that a data migration. Slug and group are independent: a shared slug across locales is now a stylistic choice (fine for product codes, wrong for prose) rather than the mechanism.

`cms_create_entry` takes `translationOf` — the id of any entry in the group to join — and pre-checks the locale so a second `nb` variant conflicts with `cms_translation_conflict` instead of poisoning the request transaction into a bare 500. `cms_list_entry_translations` returns every variant with its own slug and status. `cms_link_translation` joins two entries that were authored separately and should have been linked; `cms_unlink_translation` undoes a wrong link by minting a fresh group of one. Changing an entry's `locale` through `cms_update_entry` gets the same group pre-check.

The delivery API adds `_locales: [{ locale, slug }, …]` to a published entry — every *published* variant in its group, which is what `hreflang` and a language switcher need, and which drafts never enter. It still matches on both slug and locale, and a pair with no published row is still a `404`: `skill://cms/localize-entry` claimed a server-side fallback to the default locale that the controller never implemented, and the honest fix is documenting the `404` rather than shipping the fallback. Serving English under a Norwegian URL is worse than a miss, and `_locales` lets a frontend redirect deliberately.

Export/import keeps variants linked: `translationGroupId` rides along in the payload and is remapped to local groups on import. Payloads written before this change fall back to grouping by `(collection, slug)` — the old convention — and a variant whose target group already holds its locale is imported standalone with a warning rather than failing the import.

Migration `0062_cms_entry_translation_groups` backfills the same way, deriving the group id from `(collection_id, slug)` so it is idempotent and identical across environments. It sets `app.bypass_rls` inside the backfill: `cms_entries` is `FORCE ROW LEVEL SECURITY` and no `app.org_id` is set during a migration, so without it the `UPDATE` matches zero rows on a real deploy while a fresh CI database looks green.
