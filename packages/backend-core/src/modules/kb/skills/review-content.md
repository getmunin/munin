---
title: KB: Review and curate content
description: How an admin agent turns what a human knew — and the agent didn't — into KB documents, so the next end-user with the same question gets a real answer instead of another handover.
audiences: [admin]
---

# Review and curate content
The self-service AI agent flags a conversation with `conv_request_human` whenever it can't answer from the KB. A human (or another admin agent) then takes over and replies. That reply is the durable answer, but today it stays trapped in one conversation — the next end-user with the same question hits the same dead-end. Your job in a curation pass is to turn those (question, human-reply) pairs into KB documents so the agent can answer them next time.

What you are looking for in every mode is **knowledge the human had that the KB didn't**. A reply that the KB itself supplied is not that, however substantial it reads.

This skill walks through one pass. It supports three modes, and the prompt tells you which one you are in:

- **Gap mode** — the prompt says *"Gap mode"* and names a single `conversationId`. A human answered something the agent could not, so the answer is knowledge the KB is missing. Skip Step 1 entirely, go straight to `conv_get_conversation(<id>)`, and apply Steps 2–5 to that one conversation. This fires on every `conversation.handover_resolved` event that did not come from an approved draft.
- **Delta mode** — the prompt says *"Delta mode"* and names a draft message and a sent message. The agent wrote a reply, a human changed it, and **the change is the signal — not the reply**. See *Delta mode* below; it replaces Steps 2–3.
- **Batch mode** (no `conversationId` in the prompt) — run Steps 1–6 over the last 7 days of resolved handovers. Used as a weekly safety-net sweep to catch anything missed while the sidecar was offline, and for ad-hoc operator-initiated runs.

**A draft the human sent unchanged never reaches you.** In `draft_only` mode every reply passes through a human, so a resolved handover is the normal path there rather than a signal. The backend compares the sent body against the draft it came from and only queues a pass when they differ — an unedited approved draft is positive evidence the KB *already* covered the question, so curating it would propose a document from information the KB just supplied. Don't go looking for those conversations in batch mode either.

All modes share Steps 4–6 below. Don't refile a candidate that's already in `kb-curation-inbox` for the same source conversation — `kb_propose_curation_candidate` tags candidates with `source:<conversationId>`, so check `kb_list_documents({ tag: "candidate" })` and skip pairs whose source you've already filed.

**A source conversation is curated once, ever.** Once an operator dismisses or publishes a candidate, the draft leaves the inbox, so the inbox alone can't tell you the pair was already judged. `kb_list_curation_decisions` can: it keeps one row per decision, with the dismissal reason. `kb_propose_curation_candidate` refuses (`kb_curation_decided`) any further candidate from a decided conversation, so fetch the decisions before you start drafting and skip those sources rather than spending a draft on a refusal. If a decided conversation genuinely raised something new, write it with `kb_create_document` and say so to the operator — don't try to route around the refusal.

## TL;DR

0. **Fetch prior decisions** with `kb_list_curation_decisions` and drop those source conversations from consideration — they were already judged.
1. **List recently-resolved handovers** with `conv_list_conversations({ handover: "resolved", since })` — the server returns only conversations where a human was called in and answered inside your window.
2. **Read each conversation's messages** with `conv_get_conversation` and pull out the (end-user question, human-reply) pair. In delta mode, pull out the (draft, sent) pair instead and classify the difference.
3. **Skip duplicates and fluff.** If a candidate is functionally identical to one you've already filed, skip. If the human reply is a one-off ("yes", "ok"), skip. If the only difference in delta mode is cosmetic, skip.
4. **Draft each candidate** as a short FAQ-style markdown doc — plain prose, no headings (the `subject` is the title). Pass `sourceConversationId` and `proposedTargetSpaceSlug` as structured fields so the review UI can surface them.
5. **File each candidate** with `kb_propose_curation_candidate`. They land in the `kb-curation-inbox` KB space (admin audience only — never visible to end-user agents).
6. **Promote approved candidates** with `kb_publish_curation_candidate` once a human has reviewed them. That moves the doc into the org-facing space and removes the candidate from the inbox. In hosts that support MCP Apps, `kb_list_curation_candidates` renders the review panel and publish/dismiss happen as human clicks inside it (the publish tool is panel-only there); elsewhere the operator's agent calls the tools directly. When the panel renders, stop — don't restate the candidates in chat; it already shows the drafts, and publishing is the human's call.

## Step 1 — list candidates

```jsonc
// MCP call — a weekly pass; move `since` to match your window
{
  "name": "conv_list_conversations",
  "arguments": {
    "status": "closed",
    "handover": "resolved",
    "since": "2026-07-27T00:00:00Z",
    "limit": 100
  }
}
```

`handover: "resolved"` is the signal you want: a human was called in and answered, which is exactly the gap a KB document closes. The server applies it — the rows you get back are already the eligible set, so don't widen the query and filter by eye. `handover: "active"` (still waiting on a human) and `handover: "never"` (the agent handled it alone) are the other two states; neither belongs in a curation pass.

Run it a second time with `status: "open"` if you also want conversations a human is still working: those carry an `assigneeUserId`.

Two things the filters can't tell you, so check them yourself in Step 2:

- `handoverResolvedAt` is stamped when the handover clears. It is null for anything resolved before this field shipped, so old conversations won't appear under `handover: "resolved"` at all.
- A resolved handover is not proof a *human* typed the answer — an admin agent clears the flag the same way. Read the messages.

## Step 2 — read each pair

```jsonc
{
  "name": "conv_get_conversation",
  "arguments": { "id": "ccv_…" }
}
```

The response includes the full `messages[]` array. The pattern you're looking for:

- One or more `authorType: "end_user"` messages — the question.
- An `authorType: "agent"` message that contains text like "let me flag this for a teammate" or actually called handover — the gap signal.
- One or more later `authorType: "user"` (human staff) or `"agent"` (admin agent) messages — the answer.

Treat the *last cluster* of human/agent replies as the canonical answer for that gap. If a conversation has multiple unrelated questions, file multiple candidates from the same conversation.

## Step 3 — what to skip

- **One-word answers.** "Yes." / "Sure." / "OK" — not enough signal to make a KB doc out of.
- **Customer-specific answers.** "Your account is locked because we flagged a chargeback last week" — applies to one end-user, not the population. Don't generalize private state into KB.
- **Already-answered.** Before filing, call `kb_search` with the question's gist. If a doc with `audiences` including `self_service` already covers it, the gap was elsewhere — maybe the agent's prompt, maybe the doc's discoverability. Don't file a duplicate.
- **One-off operational state.** "We're down for maintenance until 3pm" is not a curation candidate; it's a status update.

## Delta mode — curate the edit, not the reply

Delta mode reaches you from two places, and the prompt says which.

**From a conversation.** The prompt gives a `conversationId`, the internal draft message id, the sent message id, and the KB documents the drafting agent retrieved. Call `conv_get_conversation(<id>)` once: `messages[]` contains both. The draft is the `internal: true` message whose `metadata.kind` is `draft_reply_sent`; the sent message carries `metadata.approvedDraft` with the draft's original body, so you can read the before/after pair without reconstructing it.

**From an outreach proposal.** The prompt gives a `proposalId`. Call `outreach_get_proposal(<id>)`: `originalDraftBody` is the draft as first written and `draftBody` is what the human approved. There is no retrieved-documents list here, so find the document to revise with `kb_search`. Hold this source to a higher bar — outbound copy is edited mostly for tone, length and personalisation, and a prospect's name or a rewritten opening line is never KB knowledge. Expect to file nothing unless the human corrected a fact about the product or the company.

**Classify the difference before you do anything else.** Most human edits are not knowledge, and filing them anyway is how the review queue becomes noise the operator stops reading.

| The human changed | Do |
|---|---|
| Formatting, line breaks, length, a typo | Nothing. Stop. |
| Tone, greeting, sign-off, a name or other personalisation | Nothing. Stop. |
| A **fact** — a number, a date, a policy, a name of a thing, a condition | Revise the document that carried the wrong fact. |
| Added a **caveat or exception** the draft omitted | Revise the document that should have carried it. |
| Removed a claim as wrong or not-ours | Revise the document that made the claim. |
| Answered something no retrieved document covers | File a new candidate, as in gap mode. |

**Prefer a revision over a new document.** The draft was assembled from the KB, so a corrected fact means an existing document is wrong — and filing a new FAQ beside it leaves the wrong text in place for the agent to find again. Read the retrieved documents with `kb_get_document`, pick the one whose text the human contradicted, and call `kb_propose_curation_revision` with the **full corrected body** of that document (not a patch, and not just the changed sentence — the reviewer sees your body diffed against the current one).

```jsonc
{
  "name": "kb_propose_curation_revision",
  "arguments": {
    "revisesDocumentId": "kdoc_…",
    "draftBody": "…the document's full text, with the one fact corrected…",
    "sourceConversationId": "ccv_…",
    "sourceMessageId": "cvm_…"
  }
}
```

Change as little as the correction requires. A revision that also rewrites the tone of three unrelated paragraphs is hard to approve, so the operator dismisses it and the real correction is lost with it.

Two edits are not two proposals unless they are about genuinely different things. And if the retrieved-documents list is empty, the agent answered without KB support — that is closer to gap mode, so file a new candidate instead.

## Step 4 — draft the candidate

Keep candidates short, FAQ-shaped, and channel-agnostic. Aim for 100–300 words.

**Formatting rules — strict:**

- Put the question in the `subject` argument (not in the body). The UI renders `subject` as the candidate title.
- The body is plain prose. Use **bold** and *italics* sparingly to highlight key terms. Bullet lists are fine for 2–5 short items. Inline `code` is fine for product names, IDs, or commands.
- **No headings.** Do not use `#`, `##`, or `###` anywhere in the body. The candidate already has a title (the `subject`) — a heading inside the body just duplicates it and looks bad in the review UI.
- **No JSON-escaping the body.** Pass real markdown with real newlines. Do not stringify the body so it ends up containing literal `\n` characters — the tool argument is already a string; just send the string.
- No tables, no images, no HTML. KB docs render across channels (chat, email, voice TTS) and rich blocks don't survive every channel.

Suggested shape:

```
[Direct answer in 1–3 sentences.]

[Optional: 2–4 bullet points of relevant detail.]
```

You don't need to add a "Drafted from conversation …" footer — the system stores `sourceConversationId` as a structured field and surfaces it in the review UI.

## Step 5 — file the candidate

```jsonc
{
  "name": "kb_propose_curation_candidate",
  "arguments": {
    "subject": "Weekend opening hours",
    "draftBody": "We're open **10–16 on Saturdays** and 12–16 on Sundays. The downtown branch keeps weekday hours every day.",
    "sourceConversationId": "ccv_…",
    "proposedTargetSpaceSlug": "support-faq"
  }
}
```

Behavior:

- The first call ever materializes the `kb-curation-inbox` KB space (admin audience). Subsequent calls reuse it.
- The candidate is created as a regular `kb_documents` row inside that space, tagged `curation` + `candidate`, audience `admin` only. It is **not** visible to end-user agents — they keep getting handovers for the same gap until the operator promotes the candidate.
- A `kb.curation_candidate.proposed` realtime event fires for any subscribed agent or scheduled runner.

## Step 6 — review and promote (the operator's loop)

After your pass, the operator reviews the inbox. They can list candidates with:

```jsonc
{
  "name": "kb_list_curation_candidates",
  "arguments": {}
}
```

Each row includes `proposedTargetSpaceSlug` and `sourceConversationId` parsed from the tags. (`kb_list_documents({ tag: "candidate" })` returns the same docs without those fields.)

Read each one (`kb_get_document`), edit if needed (`kb_update_document`), then promote:

```jsonc
{
  "name": "kb_publish_curation_candidate",
  "arguments": {
    "candidateDocumentId": "kdoc_…",
    "targetSpaceSlug": "support-faq",
    "ifVersion": 1,
    "audiences": ["admin", "self_service"]
  }
}
```

That moves the doc into the target space, drops the candidate tags, and sets the audiences (default `['admin', 'self_service']` so the self-service agent can find it next time).

Rejecting instead? `kb_dismiss_curation_candidate({ candidateDocumentId, ifVersion, reason })`. It deletes the draft and records the rejection, so no later pass can refile that conversation — give it a `reason` when you have one; it's what the next reader (human or agent) sees in `kb_list_curation_decisions`.

**Publishing is bound to the text that was reviewed.** `ifVersion` is the candidate's `version` as the operator read it. If the draft moved since — your own `kb_update_document`, or anyone else's — the publish fails with `kb_version_conflict` and nothing is written to the target space. Don't re-read the document and retry with the new version: that publishes text the operator never saw. Re-read it, show them the current body, and get their word on that. The same applies to a card in the panel or a Slack button posted before the edit; both refuse rather than publishing stale text.

## What NOT to do

- **Don't auto-promote.** A human (or a trusted admin agent acting on their authority) reviews every candidate before it becomes self-service-visible. Letting an LLM-drafted doc go straight to the public KB is how you ship hallucinations to your end-users.
- **Don't file candidates from agent-only chatter.** If both messages in the pair are from agents (the self-service agent and an admin agent debating internally), there's no human-confirmed answer — skip.
- **Don't include private end-user data.** Names, emails, account numbers, internal tickets — strip them when drafting. The candidate is *general* knowledge.
- **Don't recreate the same candidate.** If you already filed one for this gap in a previous pass and it's still pending review, leave it alone. The operator hasn't gotten to it yet; piling on doesn't help.
- **Don't turn an agent-written reply back into a KB document.** In delta mode the draft was assembled from the KB, so filing the sent reply wholesale proposes a document out of text the KB just supplied — a near-duplicate of the document that fed it. Only the human's change is new.
- **Don't retry past a `kb_curation_decided` refusal.** A dismissal is the operator's answer for that conversation and it doesn't expire. Rewording the subject to slip past it wastes a pass and re-litigates a decision a human already made.

## Related

- `skill://kb/create-first-space` — populating an empty KB from scratch.
- `skill://conv/escalate-to-human` — the symmetric flow from the chat-widget bot's side.
