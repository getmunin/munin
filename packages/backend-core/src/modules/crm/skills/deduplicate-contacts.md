---
title: CRM: Deduplicate contacts
description: Find duplicate contacts (same person, multiple rows) and consolidate them. There is no merge tool — this skill documents the manual reconcile pattern.
audiences: [admin]
---

# Deduplicate contacts
`crm_bulk_create_contacts` skips on email/phone match, but legacy data and human entry create overlap anyway. There is **no `crm_merge_contacts` tool today** — duplicates must be reconciled manually by promoting one row as the keeper, copying useful fields onto it, and re-pointing activities/deals.

## TL;DR

1. `crm_list_contacts` (paginated) — pull the full list.
2. Group by email and phone in your own buffer; flag clusters with >1 row.
3. For each cluster: pick a keeper, merge fields onto it via `crm_update_contact`, then leave the duplicates as orphans (or tag them for archival).
4. Log a reconciliation note on the keeper so the audit trail is clear.

## Step 1 — pull contacts

```jsonc
{ "name": "crm_list_contacts", "arguments": { "limit": 200 } }
```

`limit` caps at 200; iterate with smaller groups if the org is larger (the tool returns newest-updated-first; pagination is via `companyId`/`tag` filters since there's no offset cursor today).

For very large orgs, narrow by `tag` or `companyId` first.

## Step 2 — find duplicates

In your buffer, group by:
- Lowercased trimmed `email`
- E.164-normalized `phone`

Cluster sizes ≥ 2 are duplicates. Note that two real people sharing `support@acme.com` is legitimate — eyeball the cluster before merging.

`crm_find_contact` is helpful for spot checks but not for full scans:

```jsonc
{ "name": "crm_find_contact", "arguments": { "email": "vita@acme.com" } }
```

## Step 3 — pick the keeper

Heuristics, in order:
1. The one with `endUserId` set (linked to a real auth user — never delete this row).
2. Most recent `lastContactedAt`.
3. Most complete fields (most non-null values).
4. Oldest `createdAt` (preserves the original system-of-record row).

## Step 4 — gather context on the duplicates

Before merging, list activities and deals per duplicate so nothing's lost:

```jsonc
{ "name": "crm_list_activities", "arguments": { "contactId": "<dupId>", "limit": 200 } }
```

Note: there is no built-in "reassign activities to the keeper" tool. Activities stay on whatever contactId they were logged under. Document that fact in your reconciliation note.

## Step 5 — merge fields onto the keeper

```jsonc
{
  "name": "crm_update_contact",
  "arguments": {
    "id": "<keeperId>",
    "patch": {
      "name": "<best name from the cluster>",
      "phone": "<keeper's existing phone OR a duplicate's phone if keeper had none>",
      "title": "<most current title>",
      "address": "<most complete address>",
      "tags": ["<union of all tags>"],
      "customFields": { "<merged custom fields>": "..." }
    }
  }
}
```

Don't change `email` (it's the dedup key); the keeper should already have the canonical email.

## Step 6 — flag the duplicates

There's no soft-delete tool. Tag duplicates so they're filterable but not actively used:

```jsonc
{
  "name": "crm_update_contact",
  "arguments": {
    "id": "<dupId>",
    "patch": {
      "tags": ["dedup-archived-2026-05"],
      "customFields": { "mergedInto": "<keeperId>", "mergedAt": "2026-05-01" }
    }
  }
}
```

Optionally set `doNotContact: true` so future bulk imports skip them.

## Step 7 — log on the keeper

```jsonc
{
  "name": "crm_log_activity",
  "arguments": {
    "type": "note",
    "subject": "Merged duplicates",
    "body": "Consolidated rows <dupId-1>, <dupId-2> into this contact. Activities on those rows remain on their original contactId.",
    "contactId": "<keeperId>",
    "metadata": { "mergedFrom": ["<dupId-1>", "<dupId-2>"] }
  }
}
```

## What NOT to do

- **Don't delete duplicate contacts.** There's no cascading delete that's safe — activities, deals, and history would orphan or break. Tag-and-archive is the supported pattern.
- **Don't change the email on a duplicate to "park" it.** That makes it findable as a fresh contact in the next import, which recreates the duplicate problem.
- **Don't bulk-merge without confirming.** Two people on a shared inbox (`info@acme.com`) is a real shape. Prompt the operator before merging clusters where names differ significantly.
- **Don't expect activities to follow the merge.** They stay on the original contactId. Make this clear in your log on the keeper.

## Future work

If this skill is being run frequently, propose a first-class `crm_merge_contacts` tool that atomically: copies fields, reassigns activities + deals + endUser link, and soft-deletes the source contact. Until then, the manual pattern above is the supported path.

## Related

- `skill://crm/import-and-score-leads` — bulk import that already dedupes against existing contacts.
- `skill://crm/onboard-new-customer` — single-contact dedupe pattern using `crm_find_contact`.
