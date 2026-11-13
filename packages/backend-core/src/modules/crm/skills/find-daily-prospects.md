---
title: "CRM: Find today's prospects"
description: Give a seller a short daily list of companies in their territory that fit the org's ideal customer profile, each with a dated reason to call now. Candidates come from company-data sources connected alongside Munin (business registry, job ads, procurement notices, map listings); Munin is the memory — one crm_lookup_companies call drops every company already in the CRM, and the picks are stored as owned companies with a deal and the reason, so tomorrow's list never repeats today's.
audiences: [admin]
---

# Find today's prospects

A seller opens their AI client in the morning and asks for today's list: *ten companies in my area that should hear from us, and why.* This skill produces that list and makes it stick.

Two halves, and they live in different places:

- **The data** — who exists, how big they are, who is hiring, who has a public tender out, who has reviews complaining that nobody picks up the phone. That comes from **company-data sources the seller has connected in the same client**: a national business registry, public job ads, public procurement notices, map listings. Munin does not ship these and does not store their data wholesale. If none is connected, say so and stop — there is nothing to prospect from.
- **The memory** — which companies are already customers, already in someone's pipeline, already called and turned down, and which ones this seller owns. That is the CRM, and it is what keeps day two from being day one again.

The run is safe to repeat: everything picked today is in the CRM afterwards, so tomorrow's dedupe drops it.

## TL;DR

1. **Load the brief**: the ideal customer profile, the seller's territory, and how many to return (default 10). Never invent a profile.
2. **Check the seller's backlog** with `crm_list_companies({ ownerUserId: "me", tag: "prospect" })`.
3. **Gather candidates** from the connected sources — three to five times the number you need, each with its business registration (country + number).
4. **Drop what the CRM already knows** with one `crm_lookup_companies` call over every candidate.
5. **Screen and score** against the profile. Every pick needs at least one concrete, dated signal.
6. **Store the picks**: `crm_create_company` owned by `"me"`, `crm_set_ai_summary` with the reason and an opening line, `crm_create_deal` in the prospecting pipeline.
7. **Present** the list, plus what you skipped and why.

## Step 1 — load the brief

You need three things before touching a data source.

**The ideal customer profile.** What makes a company a good fit and what makes it a good fit *now*: industries, size band, the signals that mean they have the problem today (hiring for the role your product replaces, reviews about the thing you fix, a tender that asks for it). The profile is the org's, not yours — take it from, in order:

1. what the seller or operator gave you in the conversation,
2. a skill or instructions the seller has installed for this (a vendor that sells through partners often ships its profile that way),
3. a knowledge-base document: `kb_search({ query: "ideal customer profile" })`.

If none of these exists, ask for one. A list scored against a profile you made up is worse than no list: it looks authoritative and wastes the seller's morning.

**The territory.** Where this seller may prospect — municipalities or regions, and sometimes industries. A seller working for a reseller usually has one by contract; respect it exactly, because two partners calling the same company is the conflict territories exist to prevent. If the profile and the territory disagree, the territory wins.

**The count.** Default 10. Fewer, better picks beat a long list nobody works through.

Also confirm there is a pipeline for prospecting work:

```jsonc
{ "name": "crm_list_pipelines", "arguments": {} }
```

Use the one the org prospects in (often named for prospecting or partners). If there is none, ask the operator which to use rather than creating one yourself.

## Step 2 — look at the backlog

```jsonc
{ "name": "crm_list_companies", "arguments": { "ownerUserId": "me", "tag": "prospect", "limit": 200 } }
```

`"me"` resolves to the signed-in seller. A caller with no user — an API key — gets `crm_invalid`; then the run belongs to a person who isn't here, so ask who it is for.

If the seller already has many untouched prospects from earlier days, say so up front and offer a smaller fresh batch. Piling ten new companies a day onto a backlog nobody calls only buries the good ones.

## Step 3 — gather candidates

Query the connected sources inside the territory, and over-fetch: three to five times the count, because the CRM and the screening in steps 4–5 will remove many.

- **Start from the registry** when there is one. It gives the identity you dedupe on — the registration country and number (`NO` + orgnr, `SE` + organisationsnummer, `DK` + CVR, `FI` + Y-tunnus, `GB` + Companies House number) — plus legal form, industry code, size and status. Registry roles (managing director, board chair) tell you who decides.
- **Then add the signal sources** for the candidates you have: an open job ad for the role in question, a public tender, reviews, opening hours, a website.
- **Keep the evidence** for each signal: which source, what it said in your own words, and its date. You will need it in step 6.

A candidate without a registration can still be used — fall back to its website domain — but a registration is the stronger key: domains are missing, shared, and change.

## Step 4 — drop what the CRM already knows

One call for the whole candidate set, up to 200 registrations and 200 domains:

```jsonc
{
  "name": "crm_lookup_companies",
  "arguments": {
    "registrations": [
      { "country": "NO", "number": "123 456 785" },
      { "country": "NO", "number": "..." }
    ],
    "domains": ["acme.example"]
  }
}
```

Inputs are normalized the way companies are stored, so spacing, dots and a trailing `MVA` don't matter. Only matches come back, under `matches`, each with its `company`. Then:

- **No match** — new to the CRM. Eligible.
- **A match** — drop it, with one exception: a company tagged `disqualified` whose `customFields.prospectRetryAfter` date has passed is eligible again. Customers, other sellers' companies, this seller's existing prospects and anything recently disqualified all stay out.
- **`invalid`** — a registration that fails its country's format or check digit. The source data is wrong; drop the candidate rather than storing it without a registration.

Never skip this step to save a call. It is what makes the list trustworthy, and it is one call.

## Step 5 — screen and score

**Screen out** before scoring:

- companies the registry marks as bankrupt, dissolved, under liquidation, or deleted;
- companies registered as reserved against marketing, where the registry carries that flag;
- sole proprietorships when the seller's outreach is email. A sole proprietor is a private person in most of Europe — in Norway an enkeltpersonforetak, in Sweden an enskild firma — and unsolicited marketing email to them needs consent. Phone outreach must respect the national opt-out register. Keep them only if the seller calls and checks the register, and mark them so the seller knows;
- anything outside the territory, however good the fit.

**Score** what is left against the profile. A pick needs:

- **fit** — industry, size and legal form match the profile, and
- **at least one concrete, dated signal** that they have the problem now: "advertised a receptionist position on 3 November", not "might need help with calls".

Rank by the strength and freshness of the signal, not by size alone. Never invent a signal, a size, a date or a person. If a source didn't say it, it doesn't go in the reason.

## Step 6 — store the picks

For each pick, in this order.

**The company**, owned by the seller and tagged so step 2 finds it tomorrow:

```jsonc
{
  "name": "crm_create_company",
  "arguments": {
    "name": "Acme Bilverksted AS",
    "domain": "acme.example",
    "registration": { "country": "NO", "number": "123456785" },
    "ownerUserId": "me",
    "tags": ["prospect"],
    "customFields": {
      "prospectFoundAt": "2026-11-13",
      "prospectSources": ["business-registry", "job-ads"]
    }
  }
}
```

If this fails with `crm_company_registration_conflict`, someone created the company since your lookup — drop it from today's list rather than retrying.

**The reason and the opening line**, as the company's AI summary — this is what the seller reads before calling, and what anyone opening the company later sees first:

```jsonc
{
  "name": "crm_set_ai_summary",
  "arguments": {
    "entityType": "company",
    "id": "<companyId>",
    "summary": "Car repair shop, 12 employees, Stavanger. Advertised a receptionist position on 3 November (job ads). Several recent map reviews say calls go unanswered at lunch.",
    "nextAction": "Call the managing director: open with the receptionist ad and ask how they handle calls while the position is open."
  }
}
```

Write the reason in your own words. Some sources' terms forbid storing their content — map and review providers in particular usually allow keeping only a place identifier — so summarize what you concluded, don't paste quotes or review text into the CRM.

**The deal**, in the prospecting pipeline's first stage:

```jsonc
{
  "name": "crm_create_deal",
  "arguments": { "name": "Acme Bilverksted AS", "pipelineId": "<pipelineId>", "companyId": "<companyId>" }
}
```

Leave `stageId` out so it lands in the first stage. Only create a contact for the decision maker if the operator wants contacts from registry roles: their name and title come from a public register, but they are still personal data. Never guess an email address or a phone number for a person.

## Step 7 — present the list

Give the seller the list in the order you ranked it. Per company, in a few lines:

- name, place, size;
- **why now** — the signal and its date;
- the suggested opening line;
- a flag if it is a sole proprietorship or anything else that needs care.

Then one line on what you left out: how many candidates you gathered, how many the CRM already knew, how many were screened out and for what. That line is how the seller learns whether the territory is running dry.

Don't restate company ids or raw JSON. The seller is about to pick up the phone.

## Running it every morning

The run is idempotent by construction — picks become CRM companies, and step 4 drops CRM companies — so a scheduled task in the seller's client can run it daily with the same brief. Keep the brief (profile source, territory, count) in that task's instructions so every run scores the same way.

## When the seller says no

A company the seller called and that turned them down should not come back next week. Record it on the company: add the `disqualified` tag, write the reason in `customFields.prospectDisqualifiedReason`, and, if the answer was "not now", a `customFields.prospectRetryAfter` date — step 4 lets it back in after that date and not before. Move the deal to the pipeline's lost stage with `crm_change_deal_stage`.

```jsonc
{
  "name": "crm_update_company",
  "arguments": {
    "id": "<companyId>",
    "patch": {
      "tags": ["prospect", "disqualified"],
      "customFields": { "prospectDisqualifiedReason": "Has a receptionist again", "prospectRetryAfter": "2027-05-01" }
    }
  }
}
```

`tags` replaces the whole list — read the company's current tags first and append.

## What NOT to do

- **Don't prospect without a profile.** Ask for one.
- **Don't leave the territory.** Not even for a perfect fit.
- **Don't skip the CRM lookup**, and don't replace it with listing companies and comparing names: `Acme AS` and `Acme Holding AS` are the same registration.
- **Don't invent signals, sizes, dates, people or contact details.**
- **Don't copy source content into the CRM** beyond what its terms allow. Store your conclusion.
- **Don't contact anyone from this skill.** It produces a list and CRM records. Calls and emails are the seller's, or go through `skill://outreach/draft-first-touch-email` and its review.

## Related

- `skill://crm/import-and-score-leads` — when the list comes from a file rather than live sources.
- `skill://crm/progress-deal-through-pipeline` — moving prospects through the pipeline after the call.
- `skill://outreach/draft-first-touch-email` — drafting a reviewed first email instead of calling.
