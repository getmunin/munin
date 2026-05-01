---
title: CRM deal progression
description: Move a deal through pipeline stages with the right activity log at each gate, then refresh AI summary so prioritization stays fresh.
audiences: [admin]
---

# CRM deal progression

A deal lives in one stage of one pipeline. Pipelines are per-org, stages are ordered, and terminal stages are flagged `winLoss: 'won' | 'lost'`. Moving to a terminal stage **auto-stamps `closedAt`** — there's no "close the deal" tool separate from `crm_change_stage`.

## TL;DR

1. `crm_list_pipelines` — confirm stage layout.
2. `crm_list_deals` — find deals to advance.
3. For each: `crm_list_activities(dealId)` to verify gate criteria are met.
4. `crm_change_stage` to advance. If the destination is `won`/`lost`, the deal is closed.
5. `crm_log_activity` recording why the deal moved.
6. `crm_set_ai_summary` on the deal so the next person looking at it has fresh context.

## Step 1 — read the pipeline

```jsonc
{ "name": "crm_list_pipelines", "arguments": {} }
```

Returns each pipeline with `stages: [{ id, name, position, winLoss }, ...]`. Stages are returned in `position` order. Note which stage ids are terminal — those auto-close.

## Step 2 — find candidate deals

```jsonc
{
  "name": "crm_list_deals",
  "arguments": { "pipelineId": "<pipelineId>", "stageId": "<currentStageId>", "limit": 200 }
}
```

Filtering by `stageId` lets you address one bottleneck at a time (e.g. all deals stuck in "Discovery" for >30 days).

## Step 3 — verify gate criteria

Each stage transition has implicit criteria. Use the activity log to validate:

```jsonc
{ "name": "crm_list_activities", "arguments": { "dealId": "<dealId>", "limit": 50 } }
```

Examples:
- **Discovery → Proposal**: at least one `meeting` activity logged.
- **Proposal → Negotiation**: at least one `email` activity sent within the last 14 days; `expectedCloseAt` set.
- **Negotiation → Closed Won**: a `note` activity from a sales human approving the move; deal `amountCents` non-zero.

These gates are conventions, not enforced by the platform. If the operator's policy is documented elsewhere, follow it; otherwise prompt before advancing.

## Step 4 — advance the stage

```jsonc
{
  "name": "crm_change_stage",
  "arguments": { "dealId": "<dealId>", "stageId": "<targetStageId>" }
}
```

If the target stage has `winLoss: 'won'` or `'lost'`, `closedAt` is stamped automatically. There is **no `crm_close_deal` tool** — closure is implicit in the terminal-stage transition.

## Step 5 — log why

```jsonc
{
  "name": "crm_log_activity",
  "arguments": {
    "type": "note",
    "subject": "Advanced to Negotiation",
    "body": "Customer signed off on the EU data-residency clause. Reviewing pricing on a follow-up call next Tuesday.",
    "dealId": "<dealId>",
    "metadata": { "fromStage": "<oldStageId>", "toStage": "<newStageId>" }
  }
}
```

Activity types: `note | call | email | meeting | task`. Use `task` with a `dueAt` if there's a follow-up commitment ("send revised quote by Friday").

## Step 6 — refresh the AI summary

The AI summary is the field that drives "what's hot" in the dashboard. Don't leave it stale after a stage move:

```jsonc
{
  "name": "crm_set_ai_summary",
  "arguments": {
    "entityType": "deal",
    "id": "<dealId>",
    "summary": "$50k TCV, 200-seat fintech. Cleared legal review (EU residency). Pricing call set for May 5. Champion: Vita (Head of Ops).",
    "nextAction": "Send revised quote with annual discount tier; confirm signing authority."
  }
}
```

Setting `summary` updates `lastAiTouchAt` and `aiSummaryAt` automatically.

## Closed deals

When the stage move closes the deal:
- The deal still appears in `crm_list_deals` — it's not soft-deleted, just `closedAt`-stamped.
- AI summary should reflect the outcome ("Won — landed at $48k ACV. Decision driven by EU residency."). This is what the next account-management person reads.
- For "lost" deals, `nextAction` is a great place to record the gap ("Lost on price; revisit in Q3 if our usage-based plan ships.").

## What NOT to do

- **Don't skip stages.** `crm_change_stage` accepts any `stageId` in the same pipeline, including jumps. The platform allows it; the audit trail makes it look like work was skipped. If you must jump, log a `note` explaining why.
- **Don't move a deal to "Closed Won" without confirming `amountCents` is set.** Pipeline reporting (and the AI summary on the company) treats won deals with $0 as a data problem.
- **Don't reuse `crm_change_stage` to "reopen" a closed deal.** It works (the platform stamps `closedAt` on terminal moves but doesn't clear it on reverse moves), but the deal will appear closed-but-active and reports get confused. Create a new deal instead with `metadata.relatedDealId`.

## Related

- `skill://crm/lead-import-and-scoring` — how the deals got into the pipeline in the first place.
- `skill://crm/customer-onboarding` — the dedup + create flow before any pipeline work.
