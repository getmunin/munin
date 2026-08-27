---
'@getmunin/backend-core': minor
'@getmunin/types': minor
'@getmunin/db': minor
---

Outreach: extract structured outcomes from a finished voice call

A voice campaign can now declare `extractionSchema` — up to 12 fields (`key`, `label`, `type`, `description`, optional `options` and `tagPrefix`) naming what to pull off each call. When a call on that campaign ends, `OutreachCallOutcomeSink` enqueues `skill://outreach/extract-call-outcome`, which reads the transcript and writes what the prospect actually said into that contact's `customFields`, plus the always-written `callOutcome`, `callOutcomeAt` and `callOutcomeConversationId`.

The fields are static per campaign and dynamic across campaigns: the operator picks what to collect, the model fills it in. That keeps values comparable enough to filter and report on without a migration per customer, which a free-form "let the model choose the fields" pass would not.

Two decisions worth recording. The enqueue is an `EventSink` on `conversation.voice.call_ended` rather than an inline call in `ConvService.changeStatus`, because the sibling identity pass lives there and adding this one would invert the module dependency — `OutreachModule` imports `ConvModule`, not the reverse. And the skill writes tags as the union of existing and new, because `tags` on a contact patch replaces the whole array while `customFields` merges key-wise; sending only the new tags would delete the segment membership that put the prospect on the call list.

`extractionSchema` is rejected on non-voice campaigns rather than silently ignored, mirroring the existing email-only guard on `sequenceSteps`. The extraction pass owns outcome fields only — identity stays with `skill://crm/extract-contact-from-message`, which runs on the same close.
