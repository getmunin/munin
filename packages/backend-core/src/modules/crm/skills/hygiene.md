---
title: CRM hygiene pass
description: Periodic curator pass — find duplicate / inconsistent contacts, file high-confidence pairs as structured merge proposals via crm_propose_merge_candidate. Designed to be run on a cadence by an admin agent (weekly is a good default). The operator reviews via crm_list_merge_proposals and resolves with crm_apply_merge_proposal / crm_dismiss_merge_proposal.
audiences: [admin]
---

# CRM hygiene pass

CRM data drifts. Imports re-add contacts under a slightly different email. Humans type the same person's name three different ways. Two reps log activity against the same prospect under separate rows because neither searched first. Left alone, this turns the CRM into a haystack — searches return three half-rows where there should be one complete one, segments under-count, and the next bulk import re-creates duplicates because the dedup key drifted.

This skill walks an admin agent through one periodic hygiene pass: pull contacts, find suspect pairs, judge each pair, and file high-confidence pairs as **structured merge proposals** via `crm_propose_merge_candidate`. A human (or trusted admin agent) then reviews each pending proposal and resolves it with `crm_apply_merge_proposal` (atomic patch + archive) or `crm_dismiss_merge_proposal` (records the rejection so the next curator pass skips the pair).

Run periodically. Don't run inline per CRM mutation — batching is cheaper and the suspect-pair signal is much stronger when you can see the whole population at once. The cloud product has a curator runner that schedules this weekly per enabled org.

## TL;DR

1. **Skim known dismissals** with `crm_list_merge_proposals({ status: "dismissed" })` — build a Set of dismissed `(contactA, contactB)` pairs to skip.
2. **List contacts** with `crm_list_contacts`, paginating until you've seen the population (filter by `tag` or `companyId` for very large orgs).
3. **Find suspect pairs** in your buffer: same lowercased email, same E.164 phone, very-similar name, or same name + company.
4. **Judge each pair.** Skip clearly-not-the-same (different companies, shared inbox like `info@acme.com`, ambiguous role/title combinations). Keep clearly-same (same email + phone, same email + similar name, same phone + same company).
5. **Pick the keeper** for each kept pair (heuristics below) and build a `recommendedPatch` of fields to copy from the duplicate onto the keeper.
6. **File each pair** with `crm_propose_merge_candidate`. Idempotent on the pair while pending — re-running next week without the operator acting just upserts the pending row with refreshed evidence.
7. **Stop.** The operator's review flow takes over — they call `crm_apply_merge_proposal` or `crm_dismiss_merge_proposal` at their cadence.

## Step 1 — fetch dismissed pairs

```jsonc
{ "name": "crm_list_merge_proposals", "arguments": { "status": "dismissed", "limit": 200 } }
```

Build a lookup keyed by canonical pair (sorted contact-id tuple). Skip these in step 4. The unique-pending-pair index at the database level prevents *pending* duplicates automatically; this step prevents you from re-proposing pairs the operator already said no to.

## Step 2 — pull contacts

```jsonc
{ "name": "crm_list_contacts", "arguments": { "limit": 200 } }
```

`limit` is capped at 200. For larger orgs, narrow by `tag` or `companyId` to keep batches tractable, or run multiple passes scoped to different segments.

## Step 3 — group and find pairs

In your buffer, build clusters keyed by:

- Lowercased trimmed `email` — strongest dedup signal.
- E.164-normalized `phone` — drop spaces, parens, dashes; if the number is ambiguous (no `+` prefix, can't infer country), skip it rather than guess.
- Normalized `name` (lowercased, trimmed, whitespace-collapsed first + last) — soft-match suggestion only; more false positives.
- `companyId` — a very-similar name at the same company is a stronger signal than the same name across two different companies.

A pair is a *suspect pair* if any of those keys match. A cluster of size ≥ 2 emits one proposal per unordered pair, not one per cluster (an operator may want to merge A+B but keep C separate).

## Step 4 — judge each pair

For each suspect pair (skipping the dismissed set from step 1), decide:

- **High confidence** — same email *and* same phone; same email + similar name; same phone + same `companyId`. → propose with `confidence: "high"`.
- **Medium confidence** — similar name + same `companyId`, no email/phone overlap; same email but inbox-shaped (`info@`, `support@`, `team@`) and the names match. → propose with `confidence: "medium"`.
- **Skip** — shared inbox with different names; different `companyId` and no overlap; clearly different role titles at the same company.
- **Can't tell** — skip and note the pair in your pass summary so a human can eyeball it later.

Be conservative. False positives waste the reviewer's time and erode trust in the curator. False negatives just mean we'll catch the pair on the next pass.

## Step 5 — pick the keeper

For each kept pair, the keeper is the contact that should remain. Heuristics in order:

1. The one with `endUserId` set (linked to a real auth user — never lose this row).
2. The most recent `lastContactedAt` (or, if both null, the most recent `updatedAt`).
3. The one with the most non-null fields (most "complete").
4. The oldest `createdAt` (preserves the original system-of-record row).

Document the chosen heuristic inside the `evidence` object so the reviewer can sanity-check.

## Step 6 — build the proposal

Construct `recommendedPatch`: the set of fields to copy from the duplicate onto the keeper *if applied*. Only include fields where the duplicate has useful data the keeper lacks (or where the duplicate's value is clearly canonical).

```jsonc
{
  "name": "crm_propose_merge_candidate",
  "arguments": {
    "contactAId": "cct_aaaaaa",
    "contactBId": "cct_bbbbbb",
    "confidence": "high",
    "evidence": {
      "sameEmail": "vita@acme.com",
      "samePhoneNormalized": "+4790000000",
      "nameMatch": { "a": "Vita Vivisectus", "b": "vita vivisectus" },
      "sameCompanyId": "cco_acme",
      "keeperReason": "has_end_user_id + more_recent_last_contacted"
    },
    "recommendedKeeperId": "cct_aaaaaa",
    "recommendedPatch": {
      "title": "Head of Ops",
      "tags": ["customer", "imported-2026-q1"]
    }
  }
}
```

Notes:

- `tags` and `customFields` in `recommendedPatch` are **full replacements** in the apply step (matching `crm_update_contact` semantics). If you want the union of both contacts' tags, build the union here.
- Don't put email/phone in the patch unless the duplicate's value is genuinely better — these are dedup keys and changing them on the keeper risks creating *new* duplicates.
- `evidence` is freeform jsonb; include whatever helps the reviewer trust the proposal at a glance.

## Step 7 — operator review (NOT the curator's job)

After the curator's pass, the operator (human or admin agent acting on their authority) reviews:

```jsonc
{ "name": "crm_list_merge_proposals", "arguments": { "status": "pending", "limit": 50 } }
```

For each pending proposal, the operator either:

- **Applies it:** `crm_apply_merge_proposal({ id })`. In a single transaction: copies `recommendedPatch` onto the keeper; reassigns the duplicate's `crm_activities`, `crm_deals` (primary contact), and `crm_relationships` (contact-typed `from_id` / `to_id`) onto the keeper; transfers the duplicate's `endUserId` to the keeper if the keeper had none; archives the duplicate (`dedup-archived-YYYY-MM` tag + `customFields.mergedInto: <keeperId>` + `doNotContact: true`, `endUserId` cleared); marks the proposal `applied`.
- **Dismisses it:** `crm_dismiss_merge_proposal({ id, reason })`. Records the rejection so the next curator pass skips this pair.

The dashboard "Needs attention" backlog card surfaces the count of pending proposals via `/api/overview/backlog`.

## What NOT to do

- **Don't auto-apply.** v1 is propose-only. The cost of a wrong merge (lost activity history, wrong `endUserId` link) is much higher than the cost of one extra human review per pair.
- **Don't propose pairs the operator already dismissed.** Step 1 exists for a reason. If you skip it, you'll churn the operator's review queue with noise.
- **Don't include private end-user data in `evidence` beyond what's needed to decide.** No payment info, no internal account states, no health/legal/financial details. The matched email, the matched phone, the names, the companyId — that's enough.
- **Don't run on every conversation.** This is a periodic batch pass. The cloud curator runner schedules it. If you're being asked to do it inline as part of a chat reply, push back — that's the wrong shape.
- **Don't use `crm_update_contact` to "manually merge" instead of proposing.** The proposals table is the audit trail and the operator's review queue. Bypassing it loses both.

## Future work

- Auto-apply for high-confidence proposals where the keeper is unambiguous and `recommendedPatch` is empty (a pure consolidation with no field choices). Gated behind an explicit org-level toggle.

## Related

- `skill://crm/contact-deduplication` — manual reconcile pattern (no proposals table). Documents the same archive convention `crm_apply_merge_proposal` uses, so the manual and automated paths produce identical end states.
- `skill://kb/curation` — sibling curator pass for conversation → KB document proposals. Different domain, same "propose, don't apply" philosophy.
