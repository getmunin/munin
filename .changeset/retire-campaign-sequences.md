---
'@getmunin/backend-core': minor
'@getmunin/db': patch
'@getmunin/types': minor
---

Outreach campaigns no longer run follow-up sequences; a sequence is a journey.

- `outreach_propose_followup`, `outreach_list_due_followups`, the daily follow-up drafting job (`MUNIN_CURATOR_OUTREACH_FOLLOWUP_CRON`) and `skill://outreach/draft-followup-email` are removed.
- `outreach_create_campaign` and `outreach_update_campaign` no longer take `sequenceSteps`, and the service refuses new steps with `outreach_sequences_retired`. Clearing them is still accepted.
- Campaigns keep the `sequenceSteps` they had, read-only, so `journeys_create_from_campaign` can still convert them; an import carries them over with a warning.
- A follow-up drafted before this can still be approved, revised or dismissed, and is still refused once the prospect has replied.
- Migration `0142_retire_campaign_sequences` closes queued runs of the retired skill and opens one alert for each enabled campaign that still lists follow-up steps and isn't run by a journey, saying its follow-ups stopped.
