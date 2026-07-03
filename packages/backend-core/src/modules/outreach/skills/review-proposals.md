---
title: Outreach: Review pending proposals
description: Operator review pass over drafted outreach proposals — approve (which sends) or dismiss each pending draft. In MCP App hosts this renders the interactive Munin Inspector panel; elsewhere, drive the same decision tools directly.
audiences: [admin]
---

# Review pending outreach proposals

Every outbound email in Munin ships through a human-approved gate: curators file drafts as **pending proposals** (`skill://outreach/draft-initial-email`, `skill://outreach/draft-reply-email`), and nothing leaves the org until an operator — or an admin agent acting on their explicit instruction — decides each one. This skill is that decision pass.

**Approving sends.** `outreach_approve_proposal` is not a status flip: for an `initial` proposal it creates the outbound conversation and sends the first email through the campaign's channel (appending the CTA link and unsubscribe footer per campaign settings); for a `reply` it sends the draft verbatim on the existing conversation. There is no undo. Never approve in bulk without reading each draft.

## In an MCP App host (Claude, Claude Desktop, …)

Call `outreach_list_proposals({ "status": "pending" })`. Hosts that support MCP Apps render the **Munin Inspector** panel (`ui://munin/inspector`) inline: one card per proposal with the contact, campaign, draft subject/body, and the curator's evidence, plus **Approve & send** and **Dismiss** buttons that call the decision tools directly. The operator clicks; you don't need to relay their decision through chat.

## Without a panel

The same flow works as plain tool calls:

1. **List** — `outreach_list_proposals({ "status": "pending" })`. Each row carries `id`, `kind`, `draftSubject`, `draftBody`, `evidence`, `proposedSendAt`, and nested `contact` / `campaign` summaries.
2. **Present each draft** to the operator: who it goes to, which campaign, the subject, the full body, and anything notable in `evidence`. Don't paraphrase the body — the operator is approving the literal text.
3. **Decide one at a time** on the operator's word:
   - `outreach_approve_proposal({ "id": "..." })` — sends immediately; the result carries `status: "sent"`, `conversationId`, `sentMessageId`.
   - `outreach_dismiss_proposal({ "id": "...", "reason": "..." })` — no send; the reason lands on the proposal for the curator's next pass.
4. **Handle refusals cleanly.** Both tools reject non-`pending` proposals (someone else may have decided it since listing — refresh rather than retry). Approval also rejects when the campaign was disabled or the contact became suppressed since drafting; that is the suppression floor working, not an error to route around.

## What not to do

- **Never approve on your own initiative.** A pending queue is not permission. The invariant that makes propose-only outreach safe is that a human read each draft.
- **Don't edit-and-approve in one breath.** If a draft needs changes, dismiss with a reason (or have the operator edit it in the dashboard) and let a fresh proposal be filed.
- **Don't loop approve over the whole list** ("approve all") unless the operator explicitly reviewed every draft and said exactly that.
