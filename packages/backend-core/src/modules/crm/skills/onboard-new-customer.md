---
title: CRM: Onboard a new customer
description: Recommended sequence for capturing a new customer, attaching them to a company, and seeding the AI summary that drives later prioritization.
audiences: [admin]
---

# Onboard a new customer
## TL;DR sequence

1. `crm_find_contact` by email — avoid duplicates.
2. If miss: `crm_create_contact` with email + name + as much structured detail as you have.
3. Optionally: `crm_create_company` and link via `crm_update_contact` `companyId`.
4. `crm_log_activity` for the source touchpoint (signup, demo, inbound email, etc.).
5. `crm_set_ai_summary` with a 2–4 sentence summary of who they are and why they matter — this powers downstream prioritization.

## Step 1 — dedupe

Always check first:

```jsonc
{ "name": "crm_find_contact", "arguments": { "email": "vita@acme.com" } }
```

Returns `null` if no match, or the contact DTO. **Do not** call `crm_create_contact` without checking — duplicate emails are allowed at the schema level (so two real people at the same shared inbox can coexist) but consolidating fragments of one human across rows is painful later.

## Step 2 — create

```jsonc
{
  "name": "crm_create_contact",
  "arguments": {
    "email": "vita@acme.com",
    "name": "Vita Soto",
    "title": "Head of Ops",
    "phone": "+1-555-0100",
    "metadata": { "source": "signup", "utm_campaign": "spring-launch" }
  }
}
```

Email + name are the two fields that make the contact useful. Title and phone are nice-to-have. `metadata` is a free-form jsonb bucket — use it for source attribution, lifecycle stage, anything else that doesn't fit a column.

## Step 3 — company linkage (when relevant)

For B2B flows, attach the contact to a company so account-level reporting works:

```jsonc
{ "name": "crm_create_company", "arguments": { "name": "Acme Corp", "domain": "acme.com" } }
```

Then:

```jsonc
{ "name": "crm_update_contact", "arguments": { "id": "<contactId>", "companyId": "<companyId>" } }
```

If a company with the same `domain` already exists, the create call returns it instead of erroring — safe to call repeatedly.

## Step 4 — log the touchpoint

`crm_log_activity` is your main "what happened" event store:

```jsonc
{
  "name": "crm_log_activity",
  "arguments": {
    "contactId": "<contactId>",
    "type": "signup",
    "summary": "Signed up via the Spring Launch landing page; selected Pro plan.",
    "metadata": { "plan": "pro", "trial_days": 14 }
  }
}
```

## Step 5 — seed the AI summary

This is the highest-leverage call. The summary surfaces in conversation views, on the contact card, and feeds reports:

```jsonc
{
  "name": "crm_set_ai_summary",
  "arguments": {
    "contactId": "<contactId>",
    "summary": "Vita runs ops at Acme Corp (50-person logistics SaaS). Just signed up for Pro after attending our spring webinar. Cited integration with their ticketing system as the deciding factor."
  }
}
```

Keep it factual, short, and dense with names + numbers. Avoid platitudes ("interested in solutions") — the summary is what other agents read first when triaging this contact.

## Idempotency notes

- `crm_create_contact` with a duplicate email creates a second row. Always `crm_find_contact` first.
- `crm_create_company` with a duplicate `domain` returns the existing company.
- `crm_log_activity` is fire-and-forget — duplicate logs are noise but not corruption.
- `crm_set_ai_summary` overwrites; multiple calls is fine.

## What good looks like

A well-onboarded contact has: email, name, title, company link, one activity row capturing how they arrived, and an AI summary you'd be happy to read in 6 months.
