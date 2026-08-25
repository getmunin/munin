---
'@getmunin/backend-core': patch
---

cms_update_collection can now toggle `localized`, so a collection created without it is no longer a dead end for translation.

`localized` was settable only at creation time even though nothing in the write or delivery path branches on it — every entry already carries a `locale` and a `translationGroupId` regardless — so the flag was declarative metadata that could not be corrected. An org that had authored a collection with `localized: false` had no path to translating those entries through MCP short of recreating the collection and migrating every entry.

The patch now accepts `localized`. Turning it on is a metadata-only write: existing entries keep their slug, locale, translation group and version. Turning it off is refused with `cms_localized_conflict` while the collection holds entries in more than one locale, so a collection cannot claim to be single-language while serving four.

`skill://cms/design-collection` said flipping was possible and lossy in both directions; it now describes what actually happens, and `skill://cms/localize-entry` gained the flip as an explicit step before fanning out translations.
