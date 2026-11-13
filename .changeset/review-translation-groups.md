---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

Review queue: the languages of one CMS entry are now one decision.

A changelog entry drafted in four languages used to show as four unrelated rows, each approved on its own. The review list now folds every entry that shares a `translation_group_id` into one row, titled in the reviewer's dashboard language (falling back to the default CMS locale, then the oldest entry), with a chip per language that fills in as languages are published. The waiting count in the tab, the sidebar badge and the overview all count that group once.

The pane gains a language switch, a "Compare with …" view that lines up every field and the slug against the reviewer's language, and a footer of three controls: approve all waiting languages, edit, and a menu. The menu groups the rest by reach: the open language (approve only this one, dismiss it) or every waiting language (schedule all, dismiss all). `⌘↵` approves all; `⇧⌘↵` approves only the open language and moves to the next waiting one. Published, scheduled and dismissed siblings stay visible as context and can be opened, but are never work.

The CMS preview is now framed in a browser bar that shows the path being previewed.

Backend:

- `CmsService.listDraftEntries` attaches `translationGroupId` and `translations` (every sibling's id, locale, status, version and title, plus whether it is the default locale) to each draft. Its limit now applies to translation groups, so a group is never cut in half at the scan boundary.
- `publishTranslationGroup`, `scheduleTranslationGroup` and `archiveTranslationGroup` decide every waiting language of a group in one request, with one publish time. The caller sends the `{ id, version }` pairs it was shown; if any language changed, was decided elsewhere, or was drafted after the list loaded, nothing is written and `cms_translations_changed` names the languages. The single-entry approve route still re-reads the entry and cannot detect a stale list.
- `POST /v1/cms/drafts/groups/:groupId/{approve,schedule,dismiss}` wrap those methods.

Scheduled and Decided still list one row per language.
