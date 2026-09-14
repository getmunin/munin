---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
---

Filter the conversation list by status, origin, channel, topic and activity window.

The conversations page fetched exactly two things — open and closed — and offered a text search over what came back. Everything settled automatically was therefore invisible from the dashboard: an operator could not see what the auto-reply and bounce classifiers had filed away, could not review what had been marked spam, and had no way to check whether something real had been caught by mistake. The data was there; nothing asked for it.

A "Filters" toggle beside the search box opens a panel with five controls:

- **Status** — any, open, snoozed, closed, spam.
- **Origin** — opened by a person, filed automatically, or one specific reason: auto-replies, bounces, no-reply senders, known junk senders, no question asked.
- **Channel** — email, chat, SMS, voice.
- **Topic** — the org's own topics, fetched the first time the panel opens.
- **Activity** — last 24 hours, 7 days, 30 days.

The panel is collapsed by default and the trigger carries a count when anything is set, so the page costs no vertical space until you want it. With no filter the list keeps its three sections (Needs you / In progress / Finished) from the same two requests as before; with any filter set it becomes one flat "Results" list from a single request, and the empty state says the filters are what is hiding everything.

`GET /v1/conversations/topics` gains `@AllowMember()` — it was the only conversation read on the operator's own page that members could not make, so the topic filter would have silently disappeared for them.
