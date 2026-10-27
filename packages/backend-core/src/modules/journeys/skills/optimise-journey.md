---
title: Optimise a live journey
description: Weekly pass over live journeys that opted in with settings.optimiser "weekly" — read goal conversion against the holdout, step and agent statistics and split results, then propose at most one change per journey as a new draft version with its hypothesis, rationale and evidence. A person reviews and publishes it; the optimiser never changes a live journey.
audiences: [admin]
---

# Optimise a live journey

You improve journeys one tested change at a time. You never edit or publish a live journey: `journeys_propose_change` opens a draft version that a signed-in person reviews in the dashboard, and only they can publish it.

## 1. Pick the journeys

`journeys_list` with `status: "live"`, then `journeys_get` each one and keep those whose live spec has `settings.optimiser: "weekly"`. Skip a journey when:

- it already has an unpublished draft (`draftVersion` is set) — someone is working on it, or your last proposal is waiting for review;
- `journeys_get_guardrails` shows a paused step — that is a problem for a person to fix, not an experiment;
- it has fewer than 100 enrollments in its report — there is not enough to learn from yet.

## 2. Finish what is running

`journeys_get_split_results`. For a split whose `sampleFull` is true:

- **A winner other than the control** (`winner` set, `pValue` below 0.05, positive lift): propose promoting it — replace the split with a direct edge to the winning path's next node. The hypothesis is "the winning path converts better for everyone"; the evidence is the split result.
- **The control won or nothing is significant**: propose removing the split and keeping the control path. Say plainly that the challenger did not beat it.

That is this week's change for the journey; stop here for it.

A split that is not yet full is still running: leave it alone and do not start a second one in the same journey.

## 3. Find the weakest step

Read `journeys_get_report` (goal conversion against the holdout, per-step arrivals, exits by reason), `journeys_get_agent_stats` and `journeys_get_node_review_stats`. Look for the biggest, most fixable drop towards the goal:

- a step where many runs exit (`message_blocked`, `proposal_dismissed`, `approval_timeout`, `wait_timeout`) or stall;
- an agent step with a high or rising fallback rate, or drafts reviewers often edit or reject;
- a wait that is longer than the time most people take to reach the goal.

Form one hypothesis that a change to that step would raise goal conversion, for example "a shorter subject line raises replies to the day-3 email" or "waiting 2 days instead of 5 catches trial users while they are still active".

## 4. Propose it as a split

Copy the live spec and add a `split` in front of the step you are changing: the current path as the control, your variant as the challenger, 50/50, `control` set to the current path and `sampleSize` large enough to detect the lift you expect (at least 200, more for small effects). Change nothing else.

Then `journeys_propose_change` with:

- `hypothesis` — one sentence, the change and the effect you expect;
- `rationale` — why, from the numbers you read;
- `evidence` — the figures you used (rates, counts, dates).

If the result shows validation errors, fix the spec and propose again only after the open draft is gone — tell the operator in your summary instead of looping.

## 5. Report

End with one line per journey: skipped and why, a promotion proposed, or the experiment you proposed with its hypothesis. Do not propose more than one change per journey per pass.
