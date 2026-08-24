---
'@getmunin/backend-core': minor
'@getmunin/db': patch
---

Publishing several locales of one article now posts one Slack line with a thread, not four headlines side by side.

A four-locale batch published four near-identical announcements into the content channel, and nothing in them said they were the same article. `cms.entry.*` payloads now carry `translationGroupId` — the id every locale variant of an article already shares, which webhook subscribers can use to revalidate a whole language switcher — and the bridge worker threads on it: the locale that publishes first gets the channel message, the rest of its group post as replies under it, and Slack's own reply count does the summarising.

Grouping is per UTC day, following the outreach-campaign parent already in `slack_notification_links` (new `subject_type` `cms_translation_group`, no buttons, never resolved). A locale published the next day starts a fresh channel message rather than reviving yesterday's thread, and an entry with no siblings posts exactly as before. No migration — the existing table carries it.
