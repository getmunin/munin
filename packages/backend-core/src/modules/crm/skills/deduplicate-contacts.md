---
title: CRM: Deduplicate contacts
description: Consolidate two contact rows that are the same person — file the pair as a merge proposal with crm_propose_merge, then resolve it with crm_apply_merge_proposal or crm_dismiss_merge_proposal. Covers the one-off duplicate you hit during other work; the scheduled population sweep is skill://crm/clean-contact-data.
audiences: [admin]
---

# Deduplicate contacts

`crm_bulk_create_contacts` skips on email/phone match, but legacy data, human entry and imports under a drifted address still create overlap. You will hit a duplicate pair in the middle of other work — two rows for the same person, one carrying the deal, the other the recent activity.

**Every merge goes through a proposal.** There is no direct merge tool, and there is no supported hand-reconcile: `crm_propose_merge` files the pair, `crm_apply_merge_proposal` performs the merge atomically. Copying fields across with `crm_update_contact` and tagging the loser looks like it works, but it leaves the duplicate's activities, deals and relationships pointing at the row you just abandoned, and it leaves no audit trail of the decision.

This skill is the one-off path: you found a pair, you want it merged. For a scheduled sweep of the whole population, run `skill://crm/clean-contact-data` instead — same tools, batch shape.

## TL;DR

1. Confirm the pair is one person (`crm_get_contact` on both).
2. Pick the keeper and build the patch of fields worth carrying over.
3. File it: `crm_propose_merge`.
4. Resolve it: `crm_apply_merge_proposal({ id, fingerprint })`, or `crm_dismiss_merge_proposal({ id, reason })` if the review says they're two people after all.

## Step 1 — confirm the pair

```jsonc
{ "name": "crm_lookup_contact", "arguments": { "email": "kari@example.no" } }
{ "name": "crm_get_contact", "arguments": { "id": "<candidateId>" } }
```

Read both rows before proposing. Two real people on a shared inbox (`info@example.com`, `post@example.no`) is a legitimate shape, not a duplicate — so is a personal and a role address for the same company when the names differ. Different `companyId` with no email or phone overlap is almost never the same person.

A row whose `customFields.mergedInto` is set is the losing side of a completed merge. It keeps its email and phone forever, so it keeps matching dedup keys — it is not a merge candidate, and `crm_propose_merge` rejects it with `crm_conflict`.

## Step 2 — pick the keeper

The keeper is the row that survives. In order:

1. The one with `endUserId` set — linked to a real auth user, never the row to lose.
2. The most recent `lastContactedAt` (or `updatedAt` if both are null).
3. The most complete row (most non-null fields).
4. The oldest `createdAt`, which preserves the original system-of-record row.

`recommendedPatch` is what gets copied from the duplicate onto the keeper on apply. Include only fields where the duplicate has something the keeper lacks, or where its value is clearly the canonical one. `tags` and `customFields` are **full replacements**, matching `crm_update_contact` semantics — pass the union yourself if that's what you want. Leave `email` and `phone` out unless the duplicate's really is better: they are the dedup keys, and changing them on the keeper can mint a fresh duplicate.

## Step 3 — file the proposal

```jsonc
{
  "name": "crm_propose_merge",
  "arguments": {
    "contactAId": "cct_aaaaaa",
    "contactBId": "cct_bbbbbb",
    "confidence": "high",
    "evidence": {
      "sameEmail": "kari@example.no",
      "samePhoneNormalized": "+4790000000",
      "keeperReason": "has_end_user_id + more_recent_last_contacted"
    },
    "recommendedKeeperId": "cct_aaaaaa",
    "recommendedPatch": { "title": "Head of Ops", "tags": ["customer", "imported-2026-q1"] }
  }
}
```

`evidence` is freeform jsonb — put in what lets a reviewer trust the pair at a glance, and nothing more. No payment details, no account states, no health or financial specifics; the matched email, the matched phone, the names and the company are enough.

Filing is idempotent on the pair while a proposal is pending: calling again upserts that row rather than creating a second one.

## Step 4 — resolve it

```jsonc
{ "name": "crm_list_merge_proposals", "arguments": { "status": "pending", "limit": 50 } }
```

Each proposal comes back with both contacts embedded, so no extra `crm_get_contact` calls are needed, and it carries the `mergeFingerprint` the apply requires. In hosts that support MCP Apps this renders a side-by-side review panel and the apply/dismiss actions are panel-only — render it and stop rather than restating the proposals in chat.

**Apply**, and the merge runs in one transaction: `recommendedPatch` is copied onto the keeper; the duplicate's activities, deals and relationships are reassigned to it; its `endUserId` transfers if the keeper had none; the duplicate is archived (`dedup-archived-YYYY-MM` tag, `customFields.mergedInto`, `doNotContact: true`); every other pending proposal referencing the duplicate is dismissed; the proposal is marked `applied`.

```jsonc
{ "name": "crm_apply_merge_proposal", "arguments": { "id": "<proposalId>", "fingerprint": "<mergeFingerprint>" } }
```

**Dismiss** when the review says they are two people. The rejection is recorded, so the next `skill://crm/clean-contact-data` pass skips the pair instead of re-filing it.

```jsonc
{ "name": "crm_dismiss_merge_proposal", "arguments": { "id": "<proposalId>", "reason": "shared inbox, different people" } }
```

The fingerprint binds the apply to the proposal that was actually read. If the keeper, patch or confidence changed since — because a curator pass re-filed the pair in place under the same id — the apply is refused with `crm_conflict`, nothing is merged, and the proposal stays pending.

## What NOT to do

- **Don't hand-merge with `crm_update_contact`.** Copying fields across and tagging the loser leaves its activities, deals and relationships on the abandoned row, and leaves no record of the decision. The proposals table is both the audit trail and the review queue.
- **Don't delete a duplicate.** Archiving is what `crm_apply_merge_proposal` does, and it's the supported end state — a delete orphans history.
- **Don't re-fetch and retry after a refused apply.** A `crm_conflict` on the fingerprint means the proposal changed under the reviewer; applying the new one merges something nobody approved. Re-read the proposal and decide again.
- **Don't auto-apply a pair you filed seconds earlier without reading both rows.** Propose-and-apply in one breath is fine when you've actually confirmed the pair in step 1; it is not a way to skip the confirmation.
- **Don't sweep the whole population here.** That's `skill://crm/clean-contact-data`, which batches, tracks already-decided pairs, and is built to run on a cadence.

## Related

- `skill://crm/clean-contact-data` — the scheduled curator pass: same tools, whole-population shape, with the already-decided-pair bookkeeping a batch run needs.
- `skill://crm/import-and-score-leads` — bulk import that already dedupes against existing contacts before creating rows.
- `skill://crm/onboard-new-customer` — single-contact lookup-before-create pattern that avoids making the duplicate in the first place.
