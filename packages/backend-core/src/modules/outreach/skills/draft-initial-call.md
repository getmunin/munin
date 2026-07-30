---
title: "Outreach: Draft an initial call"
description: Draft the opening and talking points for a first-touch outbound call on a voice campaign. One pending proposal per (campaign, contact). Only a signed-in person in the Munin dashboard can place the call — an agent never can, on any host.
audiences: [admin]
---

# Draft an initial call

Same pass as `skill://outreach/draft-initial-email`, for a campaign running on a voice channel. What you write is not a message that gets delivered — it is the **opening and talking points an AI voice agent speaks** when the call connects. Everything after the first few seconds is a live conversation you don't control.

**You cannot place the call.** `outreach_approve_proposal` refuses every caller that is not a signed-in dashboard user: agents, admin API keys, the Slack button. That is the safety floor for outbound calling and there is no argument, tool or credential that gets around it. Draft, file the proposal, tell the operator it is waiting in the dashboard inbox, and stop. `outreach_revise_proposal`, `outreach_withdraw_proposal` and `outreach_dismiss_proposal` all work — none of them dial.

Take the asymmetry seriously. A cold email is ignorable and a text is cheap; an unsolicited AI phone call interrupts someone, cannot be un-rung, and in most of Europe is the most heavily regulated thing Munin can do. Draft fewer, better calls than you would emails.

## The pass

1. **List campaigns** with `outreach_list_campaigns` and keep the enabled ones. Confirm the campaign is on a voice channel before writing spoken copy — an existing proposal shows `delivery.channelType`.
2. **Materialise the audience** with `crm_list_contacts_in_segment(campaign.segmentId)`. Already filtered for suppression and lawful basis.
3. **Skip contacts with no `phone`** — `outreach_propose_initial_message` rejects them.
4. **Be stricter than the segment.** The segment says you *may* contact them. Calling asks whether you *should*: a call needs a reason this specific person would welcome one — they asked to be called, they started something and stopped, they are mid-deal. "They match the filter" is a reason to email, not to phone. Skip the rest and say why in `evidence`.
5. **Dedupe** via `outreach_list_proposals({ kind: "initial", campaignId, contactId })` as the email pass does.
6. **File** with `outreach_propose_initial_message({ campaignId, contactId, draftBody, evidence })`. No `draftSubject` — a call has no subject, and passing one is rejected.
7. **Stop.**

## Writing for a voice agent

- **Write speech, not prose.** It will be read aloud by a text-to-speech voice. Short sentences. No markdown, no bullet characters, no headings, no emoji — they are either spoken literally or mangled.
- **No URLs, no email addresses, no reference codes.** Nobody can click a link on a phone call, and a spelled-out address is painful. If there is something to send, the point of the call is to earn permission to send it.
- **Say who is calling, from where, and why, in the first sentence.** A silent or meandering opening is how an AI call gets hung up on, and it is what a recipient's complaint will quote.
- **Give the agent a goal and boundaries, not a script to recite.** It handles the conversation; you set the intent. Say what to do if the person is busy — offer to call back, don't push.
- **Say what the agent must not do**: don't claim to be human if asked, don't quote prices or commitments you haven't given it, don't keep someone who says no.
- **Use the recipient's language.** A Norwegian number gets Norwegian.

Good:

`Open: "Hei, dette er Munin-assistenten som ringer på vegne av Kjell hos Munin. Du ba om en oppringing da du testet onboarding-flyten — passer det å snakke i to minutter?" If busy: offer to call back and end the call. Goal: book a 20-minute demo, propose Tuesday or Thursday morning. If asked whether this is a real person: say plainly it is an AI assistant. Don't discuss pricing — say Kjell will follow up by email.`

Bad:

`Hi! 👋 We wanted to reach out about **our new onboarding flow** — check it out at https://getmunin.com/onboarding and book a slot!` — emoji and markdown read aloud, a URL nobody can use, no identification, no goal, no boundaries.

## What happens on approval

A person approves in the dashboard. Munin hands the campaign's voice channel the destination number and your draft as the assistant's opening context — every supported voice vendor works the same way here, so write for the channel, not for a particular provider — then creates a stub conversation linked to the campaign so the transcript lands somewhere. Approval is refused — before dialling — if the campaign is inside its `cadenceRules` quiet hours or on a blackout date. Quiet hours are read in the campaign's `quietHoursTimezone`, so set one; without it they are read in UTC, which is not what "no calls before 08:00" means anywhere in Europe.

Follow-up sequences are not available on voice campaigns. One call, then whatever the conversation becomes.

## Related

- `skill://outreach/draft-initial-email` — the same pass where you may write at length.
- `skill://outreach/draft-initial-sms` — the short-form written equivalent.
- `skill://outreach/review-proposals` — what the operator does with what you filed, and why you cannot do it for them.
- `skill://conv/setup-voice-sms-channel` — configuring the voice channel the campaign runs on.
