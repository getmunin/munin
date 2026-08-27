---
title: Conv: Promote a topic to auto-send
description: Read a topic's draft-review record and decide whether replies on that topic can send without a human, then set or remove the topic policy.
audiences: [admin]
---

# Promote a topic to auto-send

Every topic starts manual: the agent drafts, a human approves. When a topic's drafts have
been going out unedited for long enough, the operator can promote it so replies on that
topic send without review — and the review queue gets quieter. Use this when an operator
asks what can be automated, or asks to turn automation on or off for a kind of question.

## TL;DR

1. `conv_list_topic_automation` — per-topic policy plus the last 30 days of draft outcomes.
2. Report the topics where `ready` is true, and for the rest say what `hold` is blocking them.
3. On the operator's explicit go-ahead, `conv_set_topic_automation` with `agentMode: "auto"`.
4. To step back, call it again with `"draft_only"`, or `null` to drop the policy entirely.

## Step 1 — read the record

`conv_list_topic_automation` returns, for each topic:

- `agentMode` — the current topic policy. `null` means there is none, and each conversation's
  own mode stands.
- `reviewed`, `unedited`, `edited`, `rejected` — draft outcomes inside the window, with
  `uneditedPct` / `editedPct` / `rejectedPct` alongside.
- `ready` — the numbers clear every threshold and the topic is not already on auto.
- `hold` — why it is not ready: `sample` (too few drafts reviewed to tell), `unedited` (too
  many needed editing), `rejected` (too many were thrown away).

The overview also carries `autoSendRatePct` — the share of reviewed replies on topics that
are already automated — and the thresholds themselves, so you can quote the bar rather than
guessing at it.

## Step 2 — decide, but do not decide alone

Promotion changes what customers receive without anyone reading it first. Present the
numbers and let the operator choose. Do not promote a topic because it looks ready; promote
it because an operator said to.

Two things worth saying out loud when you report:

- A topic with a high `rejectedPct` is not merely unready — it is a sign the agent is
  answering the wrong thing on that topic, which is worth fixing before automation.
- `sample` is not a failure. It means the topic has not seen enough traffic yet.

## Step 3 — set the policy

`conv_set_topic_automation` with `topicId` and `agentMode`:

- `"auto"` — replies on this topic send without review, and `autoPromotedAt` is stamped.
- `"draft_only"` — replies are filed for review. This is the safe way back.
- `"off"` — the agent stops replying on this topic altogether.
- `null` — remove the topic policy; each conversation falls back to its own mode.

Demotion is one call, needs no configuration, and takes effect on the next reply.

## What the policy does not override

A conversation whose mode an operator set deliberately — through `conv_change_agent_mode` or
the dashboard — keeps that mode. A topic promotion never re-enables an agent that somebody
turned off for one specific conversation. Conversations still on their channel default are
the ones the topic policy governs.

## Related

- `skill://conv/set-topic-and-title` — how conversations get their topic in the first place.
  A topic policy is only as good as the classification feeding it.
- `skill://conv/escalate-to-human` — the path an auto-sending topic still uses when the agent
  cannot answer.
