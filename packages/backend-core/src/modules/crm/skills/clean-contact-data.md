---
title: CRM: Clean up contact data
description: Periodic curator pass — find duplicate / inconsistent contacts, file high-confidence pairs as structured merge proposals via crm_propose_merge. Designed to be run on a cadence by an admin agent (weekly is a good default). The operator reviews via crm_list_merge_proposals and resolves with crm_apply_merge_proposal / crm_dismiss_merge_proposal.
audiences: [admin]
---

# Clean up contact data
CRM data drifts. Imports re-add contacts under a slightly different email. Humans type the same person's name three different ways. Two reps log activity against the same prospect under separate rows because neither searched first. Left alone, this turns the CRM into a haystack — searches return three half-rows where there should be one complete one, segments under-count, and the next bulk import re-creates duplicates because the dedup key drifted.

This skill walks an admin agent through one periodic hygiene pass: pull contacts, find suspect pairs, judge each pair, and file high-confidence pairs as **structured merge proposals** via `crm_propose_merge`. A human (or trusted admin agent) then reviews each pending proposal and resolves it with `crm_apply_merge_proposal` (atomic patch + archive) or `crm_dismiss_merge_proposal` (records the rejection so the next curator pass skips the pair).

Run periodically. Don't run inline per CRM mutation — batching is cheaper and the suspect-pair signal is much stronger when you can see the whole population at once. A weekly cadence is a good default; wire it up via your scheduler of choice.

## TL;DR

1. **Skim already-decided pairs** with `crm_list_merge_proposals({ status: "dismissed" })` *and* `crm_list_merge_proposals({ status: "applied" })` — build a Set of decided `(contactA, contactB)` pairs to skip.
2. **List contacts** with `crm_list_contacts`, paginating until you've seen the population (filter by `tag` or `companyId` for very large orgs). Drop every contact with `customFields.mergedInto` set — those rows are already merged away and are not merge candidates.
3. **Find suspect pairs** in your remaining buffer: same lowercased email, same E.164 phone, same platform handle, very-similar name, or same name + company.
4. **Judge each pair.** Skip clearly-not-the-same (different companies, shared inbox like `info@acme.com`, ambiguous role/title combinations). Keep clearly-same (same email + phone, same email + similar name, same phone + same company).
5. **Pick the keeper** for each kept pair (heuristics below) and build a `recommendedPatch` of fields to copy from the duplicate onto the keeper.
6. **File each pair** with `crm_propose_merge`. Idempotent on the pair while pending — re-running next week without the operator acting just upserts the pending row with refreshed evidence. Refreshing `evidence` alone is free; changing the keeper, the patch or the confidence invalidates any review already in flight (see step 7).
7. **Stop.** The operator's review flow takes over — they call `crm_apply_merge_proposal` or `crm_dismiss_merge_proposal` at their cadence. In hosts that support MCP Apps, `crm_list_merge_proposals` renders a side-by-side review panel and apply/dismiss happen as human clicks inside it (those two tools are panel-only there). Render the panel and stop — don't restate the proposals in chat; the panel already shows every field, and the merge decision is physically the human's.

## Step 1 — fetch already-decided pairs

```jsonc
{ "name": "crm_list_merge_proposals", "arguments": { "status": "dismissed", "limit": 200 } }
{ "name": "crm_list_merge_proposals", "arguments": { "status": "applied", "limit": 200 } }
```

Build a lookup keyed by canonical pair (sorted contact-id tuple) from **both** lists. Skip these in step 4. The unique-pending-pair index at the database level prevents *pending* duplicates automatically; this step prevents you from re-proposing pairs the operator already said no to, and from re-proposing pairs that were already merged.

## Step 2 — pull contacts

```jsonc
{ "name": "crm_list_contacts", "arguments": { "limit": 200 } }
```

`limit` is capped at 200. For larger orgs, narrow by `tag` or `companyId` to keep batches tractable, or run multiple passes scoped to different segments.

`crm_list_contacts` still returns rows that a previous merge archived. Discard any contact whose `customFields.mergedInto` is set before you build clusters — it kept its email and phone, so leaving it in the buffer re-derives every pair that was already merged. `crm_propose_merge` rejects those pairs with `crm_conflict`, so a pass that skips this step burns tool calls on guaranteed failures.

## Step 3 — group and find pairs

In your buffer, build clusters keyed by:

- Lowercased trimmed `email` — strongest dedup signal.
- E.164-normalized `phone` — drop spaces, parens, dashes; if the number is ambiguous (no `+` prefix, can't infer country), skip it rather than guess.
- Lowercased trimmed `handle` — within one platform a handle is as strong an identity key as email: a username is unique there and belongs to one account, so two contacts carrying the same handle are the same person. Compare bare handles (`u/vivisectus`, `@vivisectus` and `vivisectus` are one value); a handle-only row and an email-only row that share nothing else are not a pair.
- Normalized `name` (lowercased, trimmed, whitespace-collapsed first + last) — soft-match suggestion only; more false positives.
- `companyId` — a very-similar name at the same company is a stronger signal than the same name across two different companies.

A pair is a *suspect pair* if any of those keys match. A cluster of size ≥ 2 emits one proposal per unordered pair, not one per cluster (an operator may want to merge A+B but keep C separate).

## Step 4 — judge each pair

For each suspect pair (skipping the dismissed set from step 1), decide:

- **High confidence** — same email *and* same phone; same email + similar name; same phone + same `companyId`; same `handle`. → propose with `confidence: "high"`.
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
  "name": "crm_propose_merge",
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
- Don't put email/phone/handle in the patch unless the duplicate's value is genuinely better — these are dedup keys and changing them on the keeper risks creating *new* duplicates. Copying a handle onto a keeper that has none is the one clearly-good case: it gives the surviving row the identity it was missing on that platform.
- `evidence` is freeform jsonb; include whatever helps the reviewer trust the proposal at a glance.

## Step 7 — operator review (NOT the curator's job)

After the curator's pass, the operator (human or admin agent acting on their authority) reviews:

```jsonc
{ "name": "crm_list_merge_proposals", "arguments": { "status": "pending", "limit": 50 } }
```

For each pending proposal, the operator either:

- **Applies it:** `crm_apply_merge_proposal({ id, fingerprint })`. In a single transaction: copies `recommendedPatch` onto the keeper; reassigns the duplicate's `crm_activities`, `crm_deals` (primary contact), and `crm_relationships` (contact-typed `from_id` / `to_id`) onto the keeper; transfers the duplicate's `endUserId` to the keeper if the keeper had none; archives the duplicate (`dedup-archived-YYYY-MM` tag + `customFields.mergedInto: <keeperId>` + `doNotContact: true`, `endUserId` cleared); dismisses every other pending proposal that references the duplicate; marks the proposal `applied`.
- **Dismisses it:** `crm_dismiss_merge_proposal({ id, reason })`. Records the rejection so the next curator pass skips this pair.

**Applying is bound to the proposal that was reviewed.** Every proposal carries a `mergeFingerprint` over its two contacts, the recommended keeper, the recommended patch and the confidence, and `crm_apply_merge_proposal` requires it. Pass the fingerprint that came with the proposal the operator actually read.

This matters because `crm_propose_merge` does not always create a new row: on a pair that already has a pending proposal it **updates that row in place**, keeping the same id. So a curator pass that re-files the same pair with a different keeper silently rewrites the card the operator is looking at. With the fingerprint, the apply is refused with `crm_conflict` instead: nothing is merged, the proposal stays pending, and the operator re-reads it. Don't re-fetch the proposal and retry with the new fingerprint — that applies a merge nobody approved. Note that a re-propose which only refreshes `evidence` leaves the fingerprint alone, so the weekly hygiene pass does not invalidate a queue the operator is working through.

The dashboard "Needs attention" backlog card surfaces the count of pending proposals via `/v1/overview/backlog`.

## What NOT to do

- **Don't re-propose a pair with a different keeper while the operator is reviewing it.** The row is updated in place under the same id, so the card silently changes. If your judgement of the keeper changed, say so; the apply will be refused until the operator re-reads it.
- **Don't auto-apply.** v1 is propose-only. The cost of a wrong merge (lost activity history, wrong `endUserId` link) is much higher than the cost of one extra human review per pair.
- **Don't propose pairs the operator already decided.** Step 1 exists for a reason — dismissed *and* applied. If you skip it, you'll churn the operator's review queue with pairs they already resolved; a merged pair re-proposed next week looks like the merge never happened.
- **Don't treat an archived duplicate as a merge candidate.** A row with `customFields.mergedInto` set is the losing side of a completed merge. It keeps its email, phone and handle forever, so it matches every dedup key it originally matched.
- **Don't include private end-user data in `evidence` beyond what's needed to decide.** No payment info, no internal account states, no health/legal/financial details. The matched email, the matched phone, the matched handle, the names, the companyId — that's enough.
- **Don't run on every conversation.** This is a periodic batch pass — your scheduler triggers it. If you're being asked to do it inline as part of a chat reply, push back — that's the wrong shape.
- **Don't use `crm_update_contact` to "manually merge" instead of proposing.** The proposals table is the audit trail and the operator's review queue. Bypassing it loses both.

## Future work

- Auto-apply for high-confidence proposals where the keeper is unambiguous and `recommendedPatch` is empty (a pure consolidation with no field choices). Gated behind an explicit org-level toggle.

## Related

- `skill://crm/deduplicate-contacts` — manual reconcile pattern (no proposals table). Documents the same archive convention `crm_apply_merge_proposal` uses, so the manual and automated paths produce identical end states.
- `skill://kb/review-content` — sibling curator pass for conversation → KB document proposals. Different domain, same "propose, don't apply" philosophy.
