---
title: Outreach — draft replies
description: Per-message curator pass that drafts a suggested reply when an inbound message lands on an outreach-originated conversation. Drafts go to the operator review queue — never auto-send. Triggered event-driven from `conversation.message.received` whenever the conversation has an `outreachCampaignId` and `agentMode='draft_only'`.
audiences: [admin]
---

# Outreach — draft replies

When a prospect replies to an outreach email, that reply lands as an inbound message on the conversation we created from the approved initial. **The AI runner is configured to skip these conversations** (`agentMode='draft_only'`), so without this curator the conversation just sits there. Your job is to read the thread, draft a sensible reply, and file it as a `kind: 'reply'` proposal for human approval — same Review tab, same approve/dismiss flow as initials.

This is fundamentally different from `skill://outreach/draft-initial`:

- **Initial** is generative: campaign brief + KB context → personalized first email per contact.
- **Reply** is reactive: read the inbound message + thread context → addressed-to-the-message reply.

Replies must answer what the prospect actually said. If they asked a question, answer it. If they declined, acknowledge graciously and (if the campaign brief has a soft alternative ask) offer it once. If they want to talk to a human, your reply should suggest a handoff path; the operator approving will route accordingly.

## TL;DR

1. **Read the conversation** with `conv_get_conversation(<conversationId>)` (the user prompt names it). Note the `outreachCampaignId`.
2. **Read the campaign** with `outreach_get_campaign(<campaignId>)` for the brief — the reply should stay on-message.
3. **Identify the latest end-user message** — that's what you're replying TO. Earlier messages are context only.
4. **Decide intent**: question, decline, ask-for-human, off-topic, low-quality, etc. The right reply differs sharply by intent.
5. **Ground product claims** with `kb_search` if the prospect asked something factual.
6. **Draft** a 30–120-word reply that addresses the inbound. Plain prose, no headings, no JSON-escaping. **No unsubscribe footer** — replies thread inside the existing email chain which already carries the original link.
7. **File** with `outreach_propose_reply({ conversationId, draftBody, evidence })`. The proposal lands `pending`; the operator approves on `/dashboard/inbox`. Approving sends via `conv_send_message`.

## Step 1 — read the conversation

```jsonc
{ "name": "conv_get_conversation", "arguments": { "id": "ccv_…" } }
```

The response includes `outreachCampaignId`, `messages[]`, `agentMode`. Verify `agentMode === 'draft_only'` (otherwise the trigger fired in error and you should stop). Verify `outreachCampaignId !== null` (same — should not have been triggered).

## Step 2 — read the campaign

```jsonc
{ "name": "outreach_get_campaign", "arguments": { "id": "ocmp_…" } }
```

The brief tells you what the campaign is about. Stay on-message. If the inbound veered off-topic ("you wouldn't believe my weekend"), the reply should politely redirect to the original ask, not engage the off-topic detail.

## Step 3 — what to skip

- **A pending reply already exists for this conversation** — `outreach_propose_reply` will reject. Run `outreach_list_proposals({ status: 'pending', kind: 'reply', campaignId, contactId })` first to dedupe.
- **The latest message is internal** (`internal: true`) — that's a staff side-comment, not a prospect reply. Skip.
- **The latest message is from `authorType: 'user'` or `'agent'`** — that's an outbound message we already sent (or that someone just approved). The trigger should not fire on those, but defend.
- **The conversation is closed or staffed** (`status !== 'open'` or `assigneeUserId` set). The operator is handling it; don't draft on top of them.

## Step 4 — read intent

- **Question**: "What pricing tier covers <thing>?" → answer concretely from KB; if KB doesn't cover it, acknowledge and propose a follow-up (call, email, or handoff to a human).
- **Decline**: "Not interested." → one short, gracious sentence. Don't push back. Optionally one open-ended ask only if the brief has a soft alternative.
- **Ask for human**: "Can we talk to someone?" → "Of course — I'll have someone reach out today" + thank them. The operator approving the reply is implicitly that handoff.
- **Off-topic / pleasantry**: brief friendly response then redirect to the original ask.
- **Hostile / unsubscribe-intent**: don't engage. Draft a one-line acknowledgement. Operator should likely dismiss the draft AND mark the contact suppressed.

## Step 5 — ground product claims

If the prospect asked something specific that needs a factual answer ("does X integrate with Y?"), do a `kb_search` and ground in what comes back. Don't invent. If the KB has nothing, write at the level of "we'd love to walk you through X — when's good for a 15-minute call?" — punt to the operator with a defensible position.

## Step 6 — draft

- **30–120 words.** Replies are short. Conciseness signals respect for their time.
- **Plain prose.** No headings, no markdown structure, no bullet lists unless 2–3 items genuinely cluster (e.g. listing product capabilities they asked about).
- **Address what they said.** First sentence acknowledges or answers; second offers a next step if appropriate.
- **No unsubscribe footer.** The original initial carries the (signed, surviving-forwarding) link. Replies inside the same thread don't need a duplicate; including one looks robotic.
- **Voice**: warm, second-person, the way an operator would write if they had time.

## Step 7 — file the proposal

```jsonc
{
  "name": "outreach_propose_reply",
  "arguments": {
    "conversationId": "ccv_…",
    "draftBody": "Hi Jane,\n\nGreat question — yes, we integrate with Slack via OAuth (one-click; takes ~30 seconds). I'd be happy to walk you through it on a 15-minute call this week. Would Tuesday or Thursday work better?\n\n— Munin",
    "evidence": {
      "intent": "question_about_integration",
      "kbDocIds": ["kdoc_slack_integration_overview"],
      "reasoning": "Prospect asked about Slack support; KB confirms; offering a quick demo is on-brief."
    }
  }
}
```

Behavior:

- The proposal lands in `pending` status, visible to the operator on `/dashboard/inbox` Outreach tab with a Reply badge.
- An `outreach.proposal.created` realtime event fires.
- Approving sends the body verbatim via `conv_send_message` on the same conversation. No unsubscribe footer is added.

## What NOT to do

- **Don't auto-send.** No `conv_send_message` from this skill. Drafts only.
- **Don't ignore the inbound.** A reply that doesn't address what the prospect actually said reads as either a bot or a careless human.
- **Don't push when they declined.** "Just one more thing" is the cardinal sin of cold outreach. One acknowledgement, one optional soft ask, done.
- **Don't include an unsubscribe footer.** Initials carry it; replies thread inside.
- **Don't draft on a closed / staffed conversation.** A human is handling it.
- **Don't propose multiple replies per conversation.** Idempotency on `(campaign, contact, kind=reply, status=pending)` will reject.

## Related

- `skill://outreach/draft-initial` — the symmetric pattern for first-touch emails.
- `skill://kb/curation` — the original "drafted candidates, human approves" pattern this skill follows.
- `agentMode` on `conv_conversations` — `'draft_only'` is what gates the AI runner from auto-replying. Outreach conversations get this set automatically when their initial is approved.
