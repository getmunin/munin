---
title: Lead import and scoring (CRM)
description: Bulk-import contacts, attach them to companies and a deal pipeline, log the source touchpoint, and seed AI summaries for downstream prioritization.
audiences: [admin]
---

# Lead import and scoring (CRM)

When a customer hands you a list of leads (CSV from a webinar, scraped from an event registration, exported from a marketing tool), you want to land them in the CRM **without duplicates**, attach them to companies, link them to a sales pipeline, and seed an AI summary that drives later prioritization.

## TL;DR

1. `crm_bulk_create_contacts` — built-in dedup against email + phone + do-not-contact list.
2. For each new contact's company: `crm_list_companies` then `crm_create_company` if missing; `crm_update_contact` to link.
3. For each lead worth a sales motion: `crm_create_deal` against the right `pipelineId`.
4. `crm_log_activity` on each new contact so the touchpoint shows up in their timeline.
5. `crm_set_ai_summary` on each contact (and deal) so prioritization signals are populated.

## Step 1 — bulk import with built-in dedup

```jsonc
{
  "name": "crm_bulk_create_contacts",
  "arguments": {
    "contacts": [
      {
        "name": "Vita Costa",
        "email": "vita@acme.com",
        "phone": "+4799887766",
        "title": "Head of Ops",
        "tags": ["webinar-2026-04"],
        "customFields": { "leadSource": "spring-webinar" }
      },
      { "...up to 500 rows..." : true }
    ]
  }
}
```

Returns `{ created: <n>, skipped: <m> }`. Skipped rows match an existing contact by email/phone, **or** match a `doNotContact: true` contact (compliance). The tool does **not** tell you which rows were skipped — if you need to know, `crm_find_contact` per row first (slower but explicit).

Hard cap: 500 contacts per call. Chunk larger lists.

## Step 2 — companies

For each unique company domain in your list:

```jsonc
{ "name": "crm_list_companies", "arguments": { "limit": 200 } }
```

If the company doesn't exist:

```jsonc
{
  "name": "crm_create_company",
  "arguments": { "name": "Acme Inc.", "domain": "acme.com", "tags": ["customer"] }
}
```

Then attach each contact to its company:

```jsonc
{
  "name": "crm_update_contact",
  "arguments": { "id": "<contactId>", "patch": { "companyId": "<companyId>" } }
}
```

## Step 3 — pipeline + deals

```jsonc
{ "name": "crm_list_pipelines", "arguments": {} }
```

Pick the right pipeline. For each lead worth pursuing:

```jsonc
{
  "name": "crm_create_deal",
  "arguments": {
    "name": "Acme — spring webinar follow-up",
    "pipelineId": "<pipelineId>",
    "primaryContactId": "<contactId>",
    "companyId": "<companyId>",
    "amountCents": 500000,
    "currency": "USD",
    "expectedCloseAt": "2026-07-31T00:00:00Z"
  }
}
```

If `stageId` is omitted, the deal lands in the pipeline's first stage. Use `crm_change_stage` later to advance — see `skill://crm/deal-progression`.

## Step 4 — log the source touchpoint

Per imported contact, log what brought them in:

```jsonc
{
  "name": "crm_log_activity",
  "arguments": {
    "type": "note",
    "subject": "Source: Spring 2026 webinar",
    "body": "Attended the April 24 product demo. Asked about EU data residency.",
    "contactId": "<contactId>",
    "metadata": { "leadSource": "spring-webinar" }
  }
}
```

Setting `contactId` bumps the contact's `lastContactedAt` automatically — the timeline UI uses this for sorting. Activity types: `note | call | email | meeting | task`.

## Step 5 — AI summary for prioritization

```jsonc
{
  "name": "crm_set_ai_summary",
  "arguments": {
    "entityType": "contact",
    "id": "<contactId>",
    "summary": "Head of Ops at a 200-person fintech. Engaged on data-residency questions during the webinar — buyer signal. Likely budget cycle Q3.",
    "nextAction": "Send EU data-residency one-pager + propose a 30-min discovery call."
  }
}
```

Both `summary` and `nextAction` are free-text. `null` clears the field. Also set on the deal if you created one (`entityType: "deal"`).

## What NOT to do

- **Don't bulk-create without a tag.** Tag the import (`tags: ["webinar-2026-04"]`) so it's trivial to find or revert in `crm_list_contacts({ tag: "..." })` if the source turns out to be junk.
- **Don't skip the AI summary step.** Downstream prioritization (and humans skimming the list) read it. An empty summary is a buried lead.
- **Don't paste raw CSV into `customFields`.** The map is freeform but lives in the contact row forever — only what the team will actually filter on belongs there.
- **Don't import without checking compliance.** GDPR / opt-in: confirm the source had explicit consent before logging the touchpoint as `email` or `call`.

## Related

- `skill://crm/customer-onboarding` — slower path for a single named customer.
- `skill://crm/contact-deduplication` — what to do when a list has overlap with existing contacts.
- `skill://crm/deal-progression` — moving the new deals through stages.
- `skill://playbooks/customer-acquisition` — end-to-end CRM + Conv flow that starts from this import.
