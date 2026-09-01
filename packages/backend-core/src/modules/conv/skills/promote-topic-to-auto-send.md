---
title: Promote a topic to auto-send
description: Decide from the review record whether a conversation topic is ready to answer without human review, promote it, and step it back when the numbers say so.
audiences: [admin]
---

# Promote a topic to auto-send

Every topic starts with its conversations in review: the agent drafts, a human approves, edits, or rejects. When a topic's drafts keep going out unedited, reviewing them adds latency without adding judgment — promote the topic and the queue goes quiet for it. Demotion is one call, so a promotion is never a one-way door.

## 1. Read the evidence

```jsonc
{ "name": "conv_list_topic_automation", "arguments": {} }
```

Returns each topic with its mode and the last 30 days of review outcomes:

- `approvedUnedited` / `edited` / `rejected` — how humans dispatched the agent's drafts.
- `reviewedCount` — the sample those three sum to.
- `weeklyVolume` — outbound replies per week in the topic.
- `autoSent` — replies already sent without review (from conversations whose own mode is `auto`).
- `autoRate7d` (top level) — share of all replies auto-sent over the last 7 days.

## 2. Judge readiness

A topic is a promotion candidate when the humans have stopped changing anything:

- `approvedUnedited / reviewedCount ≥ 0.9` over a meaningful sample (tens of replies, not a handful).
- `rejected` is rare and recent rejections have explanations that were fixed (check Learning for shipped revisions).
- The topic is not policy-sensitive. Complaints, cancellations, and data/privacy requests stay with a human regardless of the numbers — set those topics to `draft_only` (or `off` if the agent should not reply at all) and leave them there.

A thin sample or a volatile edit rate is a reason to wait, not to promote optimistically.

## 3. Promote — or step back

```jsonc
{ "name": "conv_set_topic_automation", "arguments": { "topicId": "ctp_…", "mode": "auto" } }
```

The topic mode overrides the per-conversation mode for every conversation tagged with the topic, and the promotion timestamp is recorded. Every auto-sent reply still lands in the conversation history and the audit log — promotion removes the review step, not the record.

To step back to review, set `"mode": "draft_only"`; to silence the agent in a topic, `"mode": "off"`; to remove the override entirely, `"mode": null`. Watch `conv_list_topic_automation` after a promotion — if `rejected` or `edited` start climbing on the residual reviewed replies, or customers start re-asking, demote and let the review record rebuild.
