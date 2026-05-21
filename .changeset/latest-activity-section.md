---
'@getmunin/dashboard-pages': minor
---

Add a "Latest activity" section to the dashboard home page. Shows up to 10 events from the past 7 days (across conversations, KB, CRM, and outreach) sorted newest-first, with a typed pill, localized title, optional payload-derived detail, and a relative timestamp. Subscribes to the realtime gateway so the list updates live. Section is hidden when there's nothing in the 7-day window.

Internal: extracts `useRelative` to `lib/use-relative.ts`, adds `lib/event-display.ts` (event type → pill tone / i18n key / detail string), and introduces `dashboard.activity.types.*` i18n keys (en + nb) shared between this section and `ActivityPage`.
