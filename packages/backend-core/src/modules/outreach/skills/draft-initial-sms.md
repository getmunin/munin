---
title: "Outreach: Draft an initial text message"
description: Draft first-touch SMS outreach for a campaign running on an SMS channel. One pending proposal per (campaign, contact), capped at 480 characters, plain text. Only a signed-in person in the Munin dashboard can approve a text — an agent never sends one.
audiences: [admin]
---

# Draft an initial text message

Same shape as `skill://outreach/draft-initial-email`, with three differences that matter enough to be their own skill: a text is far shorter, it costs money per segment, and **you cannot send one**.

**Approving a text is a dashboard-only action.** `outreach_approve_proposal` refuses any caller that is not a signed-in dashboard user — agents, admin API keys, the Slack button. Draft, file the proposal, tell the operator it is waiting in the dashboard inbox, and stop. Don't retry, don't look for another tool, and don't ask for a credential that would work. `outreach_revise_proposal`, `outreach_withdraw_proposal` and `outreach_dismiss_proposal` all still work on these — none of them send anything.

## The pass

1. **List campaigns** with `outreach_list_campaigns` and keep the enabled ones. Check the campaign's channel is SMS before drafting text-shaped copy — `outreach_list_proposals` on an existing proposal shows `delivery.channelType`, or read the channel off `conv_list_channels`.
2. **Materialise the audience** with `crm_list_contacts_in_segment(campaign.segmentId)`. Already filtered for suppression and lawful basis. Anyone who ever replied `STOP` to a text is suppressed automatically and will not appear.
3. **Skip contacts with no `phone`.** `outreach_propose_initial_message` rejects them, and a rejection you could have predicted is a wasted call.
4. **Dedupe** via `outreach_list_proposals({ kind: "initial", campaignId, contactId })` exactly as the email pass does.
5. **Draft** (rules below) and file with `outreach_propose_initial_message({ campaignId, contactId, draftBody, evidence })`. No `draftSubject` — a text has no subject.
6. **Stop.**

## Writing the text

- **480 characters hard cap**, enforced by the service. That is roughly three billable segments; a single segment is 160 characters of GSM-7 (70 if you use emoji or characters outside the GSM alphabet, which silently switches the whole message to UCS-2 and triples the cost). Aim for one segment. Every character is someone's money.
- **Plain text only.** No markdown — `**bold**` and `[link](url)` arrive literally as asterisks and brackets. Write the URL bare if you need one.
- **Do not write an opt-out line.** Munin appends `Reply STOP to opt out.` at approve time when the campaign requires it, and appends the campaign CTA URL if one is set. Both are counted against the recipient's screen, not yours, so leave room.
- **Say who you are in the first clause.** A text from an unknown number with no sender is indistinguishable from spam, and unlike email there is no From line to check.
- **One ask.** There is no room for context-setting, a value proposition and a call to action. Pick the ask.
- **Match the recipient's language.** A Norwegian contact gets Norwegian; don't send translated English.

Good: `Hei Jane — Kjell fra Munin. Du ba om beskjed når vi lanserte selvbetjent onboarding. Den er live nå. Vil du ha en rask demo?`

Bad: `Hi Jane! 👋 **Great news** from the team at Munin — we've *just* shipped our new self-serve onboarding flow, which we think you'll love based on our last conversation. Check it out here: [Munin onboarding](https://…) and let us know what you think! Reply STOP to unsubscribe.` — emoji forces UCS-2, markdown arrives raw, and it hand-writes an opt-out line the system will append again.

## What happens on approval

A person approves in the dashboard. Munin composes the final body (draft + CTA + opt-out line), creates an outbound conversation on the campaign's SMS channel in `draft_only` mode, and queues the message for delivery. A reply from the prospect threads into that same conversation, so `outreach_propose_reply` works there — see `skill://outreach/draft-reply-email`, which applies to texts too.

Follow-up sequences are email-only. An SMS campaign cannot carry `sequenceSteps`, and `outreach_propose_followup` rejects a text conversation. One touch, then the reply flow.

## Related

- `skill://outreach/draft-initial-email` — the same pass for email, where you may draft at length.
- `skill://outreach/draft-initial-call` — the spoken equivalent, with a higher bar for who is worth contacting.
- `skill://outreach/review-proposals` — what the operator does with what you filed, and why you cannot do it for them.
- `skill://conv/setup-voice-sms-channel` — configuring the number, including `defaultAgentMode` and how STOP suppression works.
