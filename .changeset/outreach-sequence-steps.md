---
'@getmunin/backend-core': minor
'@getmunin/db': minor
'@getmunin/types': minor
'@getmunin/dashboard-pages': patch
---

Multi-step outreach sequences. Campaigns can define ordered `sequenceSteps` (wait period + drafting brief per step, email campaigns only); a daily curator sweep (`skill://outreach/draft-followup-email`, `MUNIN_CURATOR_OUTREACH_FOLLOWUP_CRON`) finds conversations whose next step is due via the new `outreach_list_due_followups` tool and files `kind: 'followup'` proposals with `outreach_propose_followup` into the existing human review queue. Any inbound reply permanently stops a sequence (the reply flow takes over), as does unsubscribe/suppression or dismissing a follow-up draft. Follow-ups thread into the initial's conversation with no subject or unsubscribe footer, and export/import round-trips sequences.
