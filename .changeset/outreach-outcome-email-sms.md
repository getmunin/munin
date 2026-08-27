---
'@getmunin/backend-core': minor
'@getmunin/types': minor
'@getmunin/db': minor
---

Outreach: extract outcomes from email and SMS replies, not just calls

`extractionSchema` now works on every outreach channel. A voice campaign still extracts once when the call ends; an email or SMS campaign extracts each time the prospect replies, so a campaign that asks a qualifying question in writing gets the same structured answer a call does.

The skill is renamed `skill://outreach/extract-call-outcome` → `skill://outreach/extract-outcome`, and its reserved keys `callOutcome` / `callOutcomeAt` / `callOutcomeConversationId` become `outreachOutcome` / `outreachOutcomeAt` / `outreachOutcomeConversationId`, with `wrong_number` widening to `wrong_contact` — a reply from the wrong person is the same signal as a wrong number, and none of those names were true of an email thread. Migration 0084 renames both the persisted `curator_jobs.job_uri` rows and the existing `crm_contacts.custom_fields` keys.

Three things the implementation turns on. Voice transcript turns are inserted as `end_user` messages and emit `conversation.message.received` like any inbound mail, so the sink keys the reply trigger to email and SMS channels only — otherwise every prospect utterance mid-call would enqueue an extraction job. The reply trigger dedupes per message rather than per conversation, matching the existing `outreach-draft-reply:msg:` key, so a multi-turn thread extracts once per answer and later answers supersede earlier ones. And the contact is now resolved from the `outreach_proposals` row for the conversation instead of `metadata.crmContactId`, which only the voice stub ever wrote.

The voice-only guard on `extractionSchema` is gone, since every channel a campaign can run on now supports extraction.
