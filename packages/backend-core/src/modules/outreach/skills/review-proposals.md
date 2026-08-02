---
title: Outreach: Review pending proposals
description: Operator review pass over drafted outreach proposals — approve (which sends) or dismiss each pending draft, and the two agent-side corrections, revise and withdraw. Voice and SMS proposals are approved only in the Munin dashboard. In MCP App hosts this renders the interactive Munin Inspector panel.
audiences: [admin]
---

# Review pending outreach proposals

Every outbound message in Munin ships through a human-approved gate: curators file drafts as **pending proposals** (`skill://outreach/draft-first-touch-email`, `skill://outreach/draft-first-touch-sms`, `skill://outreach/draft-first-touch-call`, `skill://outreach/draft-reply-email`, `skill://outreach/draft-followup-email`), and nothing leaves the org until an operator — or an admin agent acting on their explicit instruction — decides each one. This skill is that decision pass.

**Calls and text messages are approved in the dashboard, never here.** A proposal whose campaign runs on a voice or SMS channel can only be approved by a signed-in person in the Munin dashboard. `outreach_approve_proposal` refuses every other caller — an agent, an admin API key, the Slack button — with `outreach_invalid: … approved by a signed-in person in the Munin dashboard`. That is the safety floor for outbound calling, not a configuration you can route around: don't retry, don't look for another tool, and don't ask for a credential that would work. Present the draft, say it is waiting for someone to place the call from the dashboard inbox, and stop. You can still `outreach_revise_proposal`, `outreach_withdraw_proposal`, and `outreach_dismiss_proposal` on these — none of them send anything.

**Approving sends.** `outreach_approve_proposal` is not a status flip: for an `initial` proposal it creates the outbound conversation and sends the first email through the campaign's channel (appending the CTA link and unsubscribe footer per campaign settings); for a `reply` or `followup` it sends the draft verbatim on the existing conversation. There is no undo. Never approve in bulk without reading each draft.

**Approval is bound to the draft, not to the id.** Every proposal carries a `draftFingerprint` — a digest of the campaign, the recipient, the subject, the body and the proposed send time — and `outreach_approve_proposal` requires it: `{ "id": "...", "fingerprint": "..." }`. Pass the fingerprint that came with the draft you actually read. If the draft moved since then — anyone's revision, yours included — the fingerprint no longer matches, the call fails with `outreach_conflict`, nothing is sent and the proposal stays pending. Don't re-fetch the proposal and retry with the new fingerprint: that is precisely the "approve whatever runs next" failure the check exists to stop. Re-read the current draft, present it, and get the operator's word on *that* text.

**Dismissing a follow-up stops the sequence.** A dismissed `followup` permanently ends the campaign's follow-up sequence for that contact — no later step will be drafted. That makes dismiss the right call for "stop chasing this person" and the wrong call for "reword this". For wording, revise the draft in place (below) or edit it in the dashboard review drawer, then approve the edited version.

## Four verbs, four different meanings

| Tool | Who it's for | What it means |
|---|---|---|
| `outreach_approve_proposal` | operator | Send it. No undo. Email only — voice and SMS are dashboard-only. |
| `outreach_dismiss_proposal` | operator | *Rejected.* A judgement about this draft; on a `followup` it also stops the sequence. |
| `outreach_revise_proposal` | agent | Same proposal, better text. Recipient and campaign are fixed. |
| `outreach_withdraw_proposal` | agent | *Never mind* — the draft should not have been filed. Neutral. |

Dismiss is a decision about the draft; withdraw is the agent admitting the draft was a mistake. Don't reach for dismiss to clean up after yourself, and don't withdraw a draft an operator asked you to reject — the reasons land in different fields and read differently in the audit trail.

## Revising a pending draft

`outreach_revise_proposal({ "id": "...", "reason": "...", "draftBody": "..." })` rewrites the draft in place. The proposal id, the contact, and the campaign do not change — a different recipient is a different proposal, so file a new one instead. `draftSubject` and `proposedSendAt` can be revised the same way, and `reason` is required.

The revision is recorded, not silent. Each call bumps `revisionCount` and stamps `lastRevisedAt`, `lastRevisionReason`, and the revising actor. If somebody else had already opened the draft for review before your change, `revisedAfterReviewAt` is stamped too and the review surfaces flag it — the operator who read Monday's text gets told, in the panel and in the dashboard drawer, that Wednesday's text is not what they read.

A revision also moves the proposal's `draftFingerprint`, which invalidates any approval already in flight for the old text — a panel card, a Slack button, or a dashboard drawer rendered before your change will be refused rather than sending what it displayed.

That flag is the point. **Never revise a draft an operator is mid-review on and then ask them to approve as if nothing changed.** If you revise after review, say so in the same breath you present it, and let them re-read the full body.

## Withdrawing your own draft

`outreach_withdraw_proposal({ "id": "...", "reason": "..." })` retracts a pending proposal you should not have filed: you drafted the same person twice, the prospect turned out not to qualify, the address bounced, the campaign premise no longer holds. Nothing is sent and `reason` is required.

Withdrawal is deliberately neutral. It does **not** suppress the contact, does **not** touch their consent, and does **not** stop a campaign sequence — a withdrawn `followup` leaves that step eligible again, unlike a dismissed one. If the contact genuinely should never be contacted again, that is a suppression decision: `crm_set_contact_consent` / the do-not-contact flag, not a withdrawal.

Because withdrawal clears the pending slot for that (campaign, contact, kind), you can withdraw a bad draft and file a corrected one. Prefer `outreach_revise_proposal` when the recipient is right and only the text is wrong — withdraw-and-refile loses the review history.

## In an MCP App host (Claude, Claude Desktop, …)

Call `outreach_list_proposals({ "status": "pending" })`. Hosts that support MCP Apps render the **Munin Inspector** panel (`ui://munin/inspector`) inline: one card per proposal with the contact, campaign, draft subject/body, an **Evidence** toggle that loads the curator's reasoning on click, and a `delivery` line naming the address or phone number the approval would reach. In these hosts the decision tools are **panel-only** (`_meta.ui.visibility: ["app"]`): they are hidden from you and only the operator's click can invoke them. Render the list and stop — the send decision is physically the human's.

Email proposals get **Approve & send** and **Dismiss** buttons. Voice and SMS proposals get **Dismiss** only, plus a line pointing the operator at the dashboard — the panel cannot place a call, because the server refuses any approval that does not come from a signed-in dashboard session.

## Without a panel

In hosts without MCP Apps support the decision tools appear as ordinary tools, and the same flow works as plain tool calls — for **email campaigns only**:

1. **List** — `outreach_list_proposals({ "status": "pending" })`. Each row carries `id`, `kind`, `draftSubject`, `draftBody`, `draftFingerprint`, `proposedSendAt`, `hasEvidence`, nested `contact` / `campaign` summaries, and `delivery`. The curator's `evidence` is not in the list — it runs to thousands of characters per draft and would blow the result size on a queue of any depth. `outreach_get_proposal({ "id": "..." })` returns one proposal with the full `evidence` attached.
2. **Read `delivery` first.** It names the channel and the exact destination. If `delivery.channelType` is `voice` or `sms`, there is nothing for you to approve: present the draft and the number, tell the operator it is waiting in the dashboard inbox, and move on. If `delivery.destination` is `null`, the contact has no address or number on file and approval would fail — say so instead of trying.
3. **Present each draft** to the operator: who it goes to, which campaign, the subject, and the full body. Don't paraphrase the body — the operator is approving the literal text. Where `hasEvidence` is true and the operator wants the curator's reasoning or sources, fetch that one proposal with `outreach_get_proposal` rather than pulling evidence for the whole queue. `delivery.appendsCta` / `appendsUnsubscribe` tell you what the system will add on top, so the operator isn't surprised by a footer they didn't read.
4. **Decide one at a time** on the operator's word:
   - `outreach_approve_proposal({ "id": "...", "fingerprint": "..." })` — sends immediately; the result carries `status: "sent"`, `conversationId`, `sentMessageId`. The `fingerprint` is the `draftFingerprint` of the draft you presented.
   - `outreach_dismiss_proposal({ "id": "...", "reason": "..." })` — no send; the reason lands on the proposal for the curator's next pass.
5. **Handle refusals cleanly.** Both tools reject non-`pending` proposals (someone else may have decided it since listing — refresh rather than retry). Approval also rejects a stale `fingerprint` (the draft changed after the operator read it), and rejects when the campaign was disabled, when the contact became suppressed since drafting, when the campaign is inside its quiet hours or on a blackout date, and — for `followup` proposals — when the prospect replied after the draft was filed (dismiss it; the reply flow owns the conversation now). That is the safety floor working, not an error to route around.

## What not to do

- **Never approve on your own initiative.** A pending queue is not permission. The invariant that makes propose-only outreach safe is that a human read each draft.
- **Don't revise-and-approve in one breath.** A revision resets what the operator needs to read. Revise, re-present the full body, then wait for their word.
- **Don't withdraw a draft to escape a refusal.** If approval failed because the contact was suppressed or the prospect replied, that is the safety floor doing its job — dismiss it (or leave it) rather than withdrawing to clear the slot and re-drafting around the block.
- **Don't loop approve over the whole list** ("approve all") unless the operator explicitly reviewed every draft and said exactly that.
- **Don't try to place a call.** If a voice or SMS approval is refused, that refusal is the product working as designed. There is no tool, key, or argument that makes it succeed — outbound calls and texts leave Munin only when a person clicks in the dashboard.
