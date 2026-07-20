---
'@getmunin/backend-core': minor
---

Enforce campaign cadence rules in the outreach follow-up due-scan. `outreach_list_due_followups` now holds back contacts who already received `maxPerWeekPerContact` sent touches (initials + follow-ups) in the trailing 7 days, and returns nothing on a `blackoutDates` day. Quiet hours intentionally do not gate the scan — drafting is not sending, and a midnight sweep would otherwise starve quiet-hours campaigns.
