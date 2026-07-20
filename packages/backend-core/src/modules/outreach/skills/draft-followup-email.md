---
title: 'Outreach: Draft follow-ups'
description: Scheduled curator pass (daily by default) that drafts the next sequence step for outreach conversations where the prospect has not replied. Campaigns opt in by defining `sequenceSteps`; each due follow-up is drafted from its step brief and filed for human approval — never auto-send. Any inbound reply permanently stops the sequence.
audiences: [admin]
---

# Draft outreach follow-ups
Campaigns may define an ordered follow-up sequence (`sequenceSteps` on the campaign: each step is `waitDays` + a short drafting `brief` like "gentle bump" or "share a relevant case study"). When an initial (or previous follow-up) has sat unanswered past the step's wait period, this pass drafts the next step and files it as a `kind: 'followup'` proposal for human approval — same Review tab, same approve/dismiss flow as initials and replies.

**You never send anything.** And you never chase someone who answered: the moment any inbound message lands on the conversation, the sequence is permanently stopped and `skill://outreach/draft-reply-email` owns the thread. `outreach_propose_followup` enforces this server-side — if it refuses, move on.

## TL;DR

1. **List due work** with `outreach_list_due_followups({})`. Every returned row is due *now* and pre-filtered — eligibility is not your job. An empty list means the pass is done; stop.
2. **For each row**: read the thread with `conv_get_conversation(row.conversationId)` and the campaign with `outreach_get_campaign(row.campaignId)` for the campaign brief.
3. **Draft** 30–90 words per the row's `stepBrief`, referencing the earlier email without repeating it. No subject, no unsubscribe footer — follow-ups thread inside the existing email chain, which already carries both.
4. **File** with `outreach_propose_followup({ conversationId, step: row.nextStep, draftBody, evidence })`.
5. **Stop** when every row is filed. No approving, no sending.

## Step 1 — list due follow-ups

```jsonc
{ "name": "outreach_list_due_followups", "arguments": {} }
```

Each row carries `campaignId`, `campaignName`, `contactId`, `conversationId`, `nextStep` (1-based index into the campaign's `sequenceSteps`), `stepBrief`, `waitDays`, and `lastSentAt`. The server has already excluded: replied conversations, suppressed/unconsented contacts, disabled campaigns, closed or human-assigned conversations, contacts with a pending follow-up or reply draft, sequences stopped by a dismissed step, and contacts held back by the campaign's cadence rules (`maxPerWeekPerContact` budget over the trailing 7 days, `blackoutDates`). Do not re-derive any of that — draft what you're given.

## Step 2 — read the thread and campaign

```jsonc
{ "name": "conv_get_conversation", "arguments": { "id": "ccv_…" } }
{ "name": "outreach_get_campaign", "arguments": { "id": "ocmp_…" } }
```

Read what was already sent — the follow-up must not repeat the initial's pitch. The campaign `brief` gives the overall goal; the row's `stepBrief` gives this step's specific angle. When the two pull apart, the step brief wins: step 3 of a sequence is often deliberately different in tone ("breakup email") from the campaign's opening pitch.

## Step 3 — draft

- **30–90 words.** Follow-ups are shorter than initials. The prospect has already seen the pitch; this is a nudge, not a re-send.
- **Per the step brief.** "Gentle bump" is two sentences. "Share a case study" earns a `kb_search` to ground a concrete, real example — don't fabricate customers or numbers. "Breakup email" is graceful: one line closing the loop, door left open, zero guilt.
- **Reference, don't repeat.** "Wanted to make sure my note last week didn't get buried" beats restating the offer.
- **Plain prose.** No headings, no bullet lists, no JSON-escaping.
- **No subject, no unsubscribe footer.** The thread already carries both; the send path ignores subjects on follow-ups anyway.
- **Never guilt-trip.** "I know you're busy…" once is human; twice is passive-aggressive. If the step brief smells like pressure, draft the polite version.

## Step 4 — file the proposal

```jsonc
{
  "name": "outreach_propose_followup",
  "arguments": {
    "conversationId": "ccv_…",
    "step": 2,
    "draftBody": "Hi Jane,\n\nCircling back in case my last note got buried — Acme cut their support backlog 40% in the first month with the setup I described (happy to share how). Worth a 15-minute look this week?\n\n— Munin",
    "evidence": {
      "stepBrief": "share a relevant case study",
      "kbDocIds": ["kdoc_acme_case_study"],
      "reasoning": "No reply 7 days after initial; step 2 calls for social proof; Acme case study matches their industry."
    }
  }
}
```

Behavior:

- The proposal lands in `pending` status, visible to the operator on `/dashboard/inbox` with a Follow-up badge and step number.
- Approving sends the body verbatim via `conv_send_message` on the same conversation. If the prospect replied in the meantime, approval fails and the operator dismisses — the reply flow has taken over.
- **Dismissing a follow-up permanently stops the sequence for that contact.** Operators who dislike the wording should edit-then-approve instead. Write drafts worth editing, not dismissing.

## What NOT to do

- **Don't auto-send.** No `conv_send_message` from this skill. Drafts only.
- **Don't draft for conversations the tool refuses.** A refusal means a reply landed, the step was dismissed, or a draft is already queued — all of them mean "not yours". Never work around it.
- **Don't skip ahead.** `step` must be exactly `row.nextStep`; the service rejects out-of-order steps.
- **Don't re-pitch.** The initial made the case. Follow-ups add one new thing (proof, angle, deadline) or simply nudge.
- **Don't stack asks.** One follow-up, one call to action.

## Related

- `skill://outreach/draft-initial-email` — drafts the first touch this sequence follows.
- `skill://outreach/draft-reply-email` — takes over the conversation the moment the prospect replies; an inbound reply permanently stops this sequence.
- `skill://outreach/review-proposals` — the operator flow that approves or dismisses these drafts.
