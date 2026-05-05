---
title: KB curation pass
description: How an admin agent turns resolved-handover conversations into KB documents, so the next end-user with the same question gets a real answer instead of another handover.
audiences: [admin]
---

# KB curation pass

The self-service AI agent flags a conversation with `conv_request_handover_in_my_conversation` whenever it can't answer from the KB. A human (or another admin agent) then takes over and replies. That reply is the durable answer, but today it stays trapped in one conversation — the next end-user with the same question hits the same dead-end. Your job in a curation pass is to turn those (question, human-reply) pairs into KB documents so the agent can answer them next time.

This skill walks through one pass. It supports two modes:

- **Per-conversation mode** — the user prompt names a single `conversationId` (e.g. *"Run a KB curation pass for conversation ccv_xxx"*). Skip Step 1 entirely and go straight to `conv_get_conversation(<id>)`. Apply Steps 2–5 to that one conversation only. This is what fires from the agent sidecar on every `conversation.handover_resolved` event — a (question, human-reply) pair just landed and we want to capture the answer in seconds, not next-week.
- **Batch mode** (no `conversationId` in the prompt) — run Steps 1–6 over the last 7 days of resolved handovers. Used as a weekly safety-net sweep to catch anything missed while the sidecar was offline, and for ad-hoc operator-initiated runs.

Both modes share Steps 2–6 below. Don't refile a candidate that's already in `kb-curation-inbox` for the same source conversation — `kb_propose_curation_candidate` tags candidates with `source:<conversationId>`, so check `kb_list_documents({ tag: "candidate" })` and skip pairs whose source you've already filed.

## TL;DR

1. **List recently-resolved handovers** with `conv_list_conversations`, then narrow to the ones that needed human attention but no longer do.
2. **Read each conversation's messages** with `conv_get_conversation` and pull out the (end-user question, human-reply) pair.
3. **Skip duplicates and fluff.** If a candidate is functionally identical to one you've already filed, skip. If the human reply is a one-off ("yes", "ok"), skip.
4. **Draft each candidate** as a short FAQ-style markdown doc. Include a footer line linking back to the source conversation for traceability.
5. **File each candidate** with `kb_propose_curation_candidate`. They land in the `kb-curation-inbox` KB space (admin audience only — never visible to end-user agents).
6. **Promote approved candidates** with `kb_publish_curation_candidate` once a human has reviewed them. That moves the doc into the org-facing space and removes the candidate from the inbox.

## Step 1 — list candidates

```jsonc
// MCP call
{
  "name": "conv_list_conversations",
  "arguments": {
    "status": "closed",
    "limit": 100
  }
}
```

The tool returns a page of `ConversationSummary` rows. For each row, the `needsHumanAttentionAt` field is set whenever the conversation was *ever* flagged for handover, even if the flag has since been cleared by the human reply. That's the signal you want: filter to rows where `needsHumanAttentionAt !== null` and the conversation is now `status: 'closed'` (or open with an `assigneeUserId` set, meaning a human is actively working it).

If you want to scope to a window (recommended), pass `since` (ISO timestamp) and only consider conversations whose `lastMessageAt` is within the window. A weekly pass typically covers the last 7 days.

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

## Step 4 — draft the candidate

Keep candidates short, FAQ-shaped, and channel-agnostic. Aim for 100–300 words. Suggested template:

```markdown
# When can I [thing the user asked about]?

[Direct answer in 1–3 sentences.]

[Optional: 2–4 bullet points of relevant detail.]

---
*Drafted from conversation [conv_xxxxxxxxx](… link …) on YYYY-MM-DD.*
```

The trailing footer is the traceability hook — keep it. When a future operator wonders why this doc exists, they can click through to the original conversation.

## Step 5 — file the candidate

```jsonc
{
  "name": "kb_propose_curation_candidate",
  "arguments": {
    "subject": "Weekend opening hours",
    "draftBody": "# When are you open on weekends?\n\nWe're open 10–16 on Saturdays …\n\n---\n*Drafted from conversation conv_xxx on 2026-05-04.*",
    "sourceConversationId": "ccv_…",
    "proposedTargetSpaceSlug": "support-faq"
  }
}
```

Behavior:

- The first call ever materializes the `kb-curation-inbox` KB space (admin audience). Subsequent calls reuse it.
- The candidate is created as a regular `kb_documents` row inside that space, tagged `curation` + `candidate`, audience `admin` only. It is **not** visible to end-user agents — they keep getting handovers for the same gap until the operator promotes the candidate.
- A `kb.curation_candidate.proposed` realtime event fires for any subscribed agent / cloud runner.

## Step 6 — review and promote (the operator's loop)

After your pass, the operator reviews the inbox. They can list candidates with:

```jsonc
{
  "name": "kb_list_documents",
  "arguments": { "tag": "candidate" }
}
```

Read each one (`kb_get_document`), edit if needed (`kb_update_document`), then promote:

```jsonc
{
  "name": "kb_publish_curation_candidate",
  "arguments": {
    "candidateDocumentId": "kdoc_…",
    "targetSpaceSlug": "support-faq",
    "audiences": ["admin", "self_service"]
  }
}
```

That moves the doc into the target space, drops the candidate tags, and sets the audiences (default `['admin', 'self_service']` so the self-service agent can find it next time). Discarding instead? Just `kb_delete_document`.

## What NOT to do

- **Don't auto-promote.** A human (or a trusted admin agent acting on their authority) reviews every candidate before it becomes self-service-visible. Letting an LLM-drafted doc go straight to the public KB is how you ship hallucinations to your end-users.
- **Don't file candidates from agent-only chatter.** If both messages in the pair are from agents (the self-service agent and an admin agent debating internally), there's no human-confirmed answer — skip.
- **Don't include private end-user data.** Names, emails, account numbers, internal tickets — strip them when drafting. The candidate is *general* knowledge.
- **Don't recreate the same candidate.** If you already filed one for this gap in a previous pass and it's still pending review, leave it alone. The operator hasn't gotten to it yet; piling on doesn't help.

## Related

- `skill://kb/kb-onboarding` — populating an empty KB from scratch.
- `skill://conv/handoff-from-ai-agent` — the symmetric flow from the chat-widget bot's side.
