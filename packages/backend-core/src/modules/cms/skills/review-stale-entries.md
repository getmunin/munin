---
title: CMS: Review stale entries
description: Periodic curator pass — find drafts that have stalled, published entries that haven't been touched in months, and orphaned assets. Reports findings with recommended actions. No persistence layer; the operator reviews the curator-runner's log/reply and acts manually via existing CMS tools.
audiences: [admin]
---

# Review stale entries
CMS data accumulates: drafts that someone started but never published, articles that were great two years ago but reference a product that's been retired, asset uploads from a campaign that ended last quarter. None of this is wrong individually — together it makes search worse, makes the editorial team trust the CMS less, and makes "is this current?" the first question every consumer asks.

This skill walks an admin agent through one periodic stale-content pass. The agent finds suspect items, judges each one against the org's velocity and content style, and produces a structured report. There's no proposal queue or merge-table for v1 — the report goes back as the curator-runner's reply, the operator reads it, and they (or their admin agent) act on it via the existing `cms_*` tools.

Run periodically. Quarterly is a good default for content-stable orgs; monthly for fast-moving ones. Don't run inline per CMS write — staleness is a population property, not a per-row property.

## TL;DR

1. **Inventory collections** with `cms_list_collections` so you know the velocity expectations of each (a docs collection is updated less often than a "weekly product update" collection).
2. **Find stale drafts** — `cms_list_entries({ status: "draft" })`, filter to `updatedAt > 30 days ago`, and judge each one ("is this clearly abandoned?" vs "is this work in progress that just got blocked?").
3. **Find stale published entries** — `cms_list_entries({ status: "published" })`, filter to `updatedAt > N months ago` per collection's velocity. For each, run `cms_list_inbound_references` to see if the entry is still load-bearing or has been superseded.
4. **Find orphaned assets** — `cms_list_assets`, cross-reference against entry bodies (search for asset IDs in entries' `data` payloads) to find uploads no entry points to.
5. **Compose a structured report** grouped by recommended action: `archive`, `refresh`, `delete-asset`, `keep`. Include enough evidence per item that a reviewer can decide without re-querying.
6. **Stop.** The operator reviews the report (your reply-to-the-user output for ad-hoc runs, or the scheduled-runner log if you're invoked from a cron) and acts on it manually using the existing `cms_*` tools.

## Step 1 — collections inventory

```jsonc
{ "name": "cms_list_collections", "arguments": {} }
```

For each collection, infer a *velocity expectation* from its purpose:

- **Reference / docs / FAQ** — published entries should be reviewed at least every 6 months; drafts older than 60 days are suspicious.
- **News / weekly update / changelog** — published entries become stale fast (the news from 2 years ago isn't relevant); drafts older than 14 days are almost certainly abandoned.
- **Marketing landing / campaign** — tied to specific dates; check the entry body for date references that have passed.
- **Settings / configuration entries** — should be touched only when something changes; long stability is a feature, not staleness.

Make the velocity threshold per-collection in your judgment. Don't apply one global cutoff — a 14-month-old "About us" page is fine, a 14-month-old "Q2 2024 promotions" page is not.

## Step 2 — stale drafts

```jsonc
{ "name": "cms_list_entries", "arguments": { "status": "draft", "limit": 200 } }
```

For each draft older than the collection's threshold, decide:

- **Abandoned** — recommend `archive` or `delete`. Triggers: same author hasn't touched it in 60+ days; very short body (<200 chars) suggesting it never got going; title suggests an event/launch that has passed.
- **Work in progress** — leave alone. Triggers: long body actively being edited (use `cms_list_versions` to see edit velocity); recent author activity in other entries.
- **Stuck on a blocker** — leave alone but flag for the reviewer to ping the author.

## Step 3 — stale published entries

```jsonc
{ "name": "cms_list_entries", "arguments": { "status": "published", "limit": 200 } }
```

For each entry older than the collection's threshold (per Step 1's per-collection velocity), check inbound references:

```jsonc
{ "name": "cms_list_inbound_references", "arguments": { "entryId": "cme_..." } }
```

Then judge:

- **Still load-bearing** — has many inbound references from active entries, or is in a top-level navigation collection. Recommend `refresh` (the operator should re-read it for accuracy) rather than archiving.
- **Superseded but referenced** — newer entries cover the same topic and are linked-to in the same neighborhood. Recommend `archive` (`cms_unpublish_entry`) but flag the inbound references so the operator can decide whether to redirect or delete them.
- **Orphaned** — no inbound references and `updatedAt` very old. Recommend `delete` (`cms_delete_entry`).
- **Time-bound** — title or body references a date/event that has passed (campaign, version-specific docs). Recommend `archive` or `delete` with high confidence.

## Step 4 — orphaned assets

```jsonc
{ "name": "cms_list_assets", "arguments": { "limit": 200 } }
```

For each asset, check whether any entry references it. Asset references typically appear inside entry `data` payloads (image fields, gallery fields, file uploads). The skill doesn't have a direct "list inbound references for this asset" tool — instead:

- Use `cms_search` with the asset id as the query to find entries that mention it.
- Or if the asset's filename is distinctive, search by filename.

If no entries reference the asset *and* `createdAt` is more than 90 days old, recommend `delete-asset` (`cms_delete_asset`). Be careful with recently uploaded assets — they may be tied to a draft entry that's still in progress.

## Step 5 — compose the report

Structure the output so an operator can scan it. Group by recommended action, not by collection. Per item: id, title, collection, last-updated date, evidence, recommended action. Example:

```markdown
## CMS stale-content review — 2026-05-04

### Archive (low-risk)

- **cme_abc123** — *"Q4 2024 holiday promotions"* (campaigns) — last updated 2024-11-15
  - Time-bound title, holiday already passed; 0 inbound references
  - Action: `cms_unpublish_entry({ id: "cme_abc123" })`, then `cms_delete_entry` after a 30-day soft window

### Refresh (still load-bearing, but stale)

- **cme_def456** — *"Pricing"* (top-level) — last updated 2024-08-12
  - 23 inbound references; in main navigation
  - Action: re-read for accuracy; verify pricing tiers haven't changed; bump `updatedAt`

### Delete (orphaned drafts)

- **cme_ghi789** — *"Untitled draft"* (blog) — last updated 2025-09-01
  - Body length 47 chars; never published; same author has not edited in 8 months
  - Action: `cms_delete_entry({ id: "cme_ghi789" })`

### Delete asset (orphaned upload)

- **cma_jkl012** — *"campaign-banner-q3.png"* — uploaded 2024-06-20
  - No entries reference this filename; not in any draft
  - Action: `cms_delete_asset({ id: "cma_jkl012" })`

### Keep (stable on purpose)

- **cme_mno345** — *"About us"* (top-level) — last updated 2023-04-10
  - Despite age, content is stable by design (org history); 12 inbound references
  - Action: none (annotated for the next pass to skip)
```

The operator reviews this report and runs the recommended commands. None of the recommendations execute automatically.

## What NOT to do

- **Don't auto-execute.** v1 of this skill is propose-only. Even `delete` on an orphaned draft is the operator's call — the agent might be wrong about what's load-bearing.
- **Don't apply one global staleness threshold.** A 14-month-old "About us" page is healthy; a 14-month-old "Q2 2024 promotions" page is not. Per-collection velocity in Step 1 is the whole point.
- **Don't recommend deleting entries with active inbound references** without flagging the references explicitly — silent breakage is worse than visible staleness.
- **Don't recurse into the full-text content of every published entry on every pass.** The pass should be cheap. Sample, prioritize obvious cases, and let next quarter's pass cover what this one didn't.
- **Don't include private end-user data in the report** (a stale entry's body might contain customer names, account ids, etc.). Reference items by id + title; let the reviewer open them in context.

## Future work

- A `cms_curation_proposals` table (mirroring `crm_merge_proposals`) so this skill produces a persistent review queue instead of a one-shot report. Add when the volume justifies it.
- Per-asset inbound-reference check (a dedicated tool that walks all entries' `data` for asset id mentions). Today the skill uses `cms_search` as a workaround.
- Automated `cms_unpublish_entry` for the high-confidence "time-bound, expired, zero references" subset, gated behind an explicit org-level toggle.

## Related

- `skill://kb/review-content` — sibling curator pass for conversation → KB document candidates. Different domain, similar "propose, don't apply" philosophy. KB curation has a persistent inbox; CMS stale-content review v1 does not.
- `skill://crm/clean-contact-data` — sibling curator pass for CRM merge proposals. Different domain, structured proposals table.
