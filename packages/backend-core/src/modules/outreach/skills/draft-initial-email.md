---
title: Outreach: Draft an initial email
description: Periodic curator pass that drafts personalised first-touch outreach emails for every enabled campaign. One pending proposal per (campaign, contact). Drafts go into the operator review queue — never auto-send. Runs weekly by default; the operator approves each draft before it leaves the org.
audiences: [admin]
---

# Draft an initial outreach email
Operators set up campaigns (`outreach_create_campaign`) with a one-paragraph **brief** and a target **CRM segment**. Your job in a pass is to materialise the segment, draft a personalised first-touch email per contact, and file each draft as a pending **proposal** for human review. **You never send anything.** The operator approves each proposal one by one (or a trusted admin agent does on their behalf), at which point the system sends via the campaign's email channel and threads any reply back into the same conversation.

This pass is symmetric with `skill://kb/review-content` (drafted candidates) but for outreach instead of KB. Always-propose is non-negotiable: an LLM-drafted cold email going straight to a prospect is exactly how you ship a tone-deaf message you can't take back. Human approval is the system invariant.

A separate `skill://crm/clean-contact-data` runs weekly to merge any duplicate contacts this and other curators leave behind. Don't try to do hygiene's job here — keep the per-campaign pass narrow.

## TL;DR

1. **List campaigns** with `outreach_list_campaigns`. Skip rows where `enabled = false` or `autoDraftInitial = false` (the latter are drafted manually on demand, not by this weekly pass).
2. **For each campaign**, materialise the audience with `crm_list_contacts_in_segment(campaign.segmentId)`. The list is *already* filtered for suppression (`do_not_contact`, `unsubscribed_at`) and lawful basis (`consent_lawful_basis IS NOT NULL`) — that floor is non-overridable in the service. Treat what comes back as the eligible set.
3. **For each contact in the audience**, dedupe via `outreach_list_proposals({ kind: "initial", campaignId, contactId })`. Skip if any proposal is `pending`, `approved`, or `sent` (already drafted or already reached). Only `dismissed`/`failed` allow a re-draft.
4. **Pull product context** with `kb_search` against the brief — find 1–3 relevant KB snippets to ground the email in real facts (don't fabricate features).
5. **Draft** an 80–200-word email, personalised to the contact's name + company. Plain prose, no headings, sparing bold/italic, no JSON-escaping. The unsubscribe footer is appended **at approve-time** by the system — do not include one in your draft.
6. **File** with `outreach_propose_initial({ campaignId, contactId, draftSubject, draftBody, evidence })`. The `evidence` JSONB carries the (KB doc ids, contact-tag matches, reasoning summary) you'd want a human reviewer to see — keep it short and structured.
7. **Stop.** No further calls. The operator's approval flow does the sending.

## Step 1 — list enabled campaigns

```jsonc
{ "name": "outreach_list_campaigns", "arguments": {} }
```

Each row carries `id`, `name`, `brief`, `segmentId`, `channelId`, `cadenceRules`, `ctaUrl`, `enabled`, `autoDraftInitial`, `autoDraftReplies`, `unsubscribeRequired`. Filter to `enabled = true` AND `autoDraftInitial = true` (a campaign with `autoDraftInitial = false` is live but the operator drafts first-touch by hand — leave it alone). Skim `cadenceRules.maxPerWeekPerContact` for sanity (it doesn't gate you here — it's enforced at send-time — but if you see `1` you should be especially conservative about re-running too often).

## Step 2 — materialise the audience

```jsonc
{ "name": "crm_list_contacts_in_segment", "arguments": { "id": "<segmentId>", "limit": 200 } }
```

You get `ContactDto[]` already pre-filtered. Each contact has `id`, `name`, `email`, `companyId`, `tags`, `consentLawfulBasis`, `lastContactedAt`, etc. **Do not** call `crm_list_contacts` directly — that surface bypasses the suppression+consent floor.

If the segment returns 0 contacts, skip this campaign entirely.

## Step 3 — dedupe before drafting

```jsonc
{
  "name": "outreach_list_proposals",
  "arguments": { "kind": "initial", "campaignId": "<id>", "contactId": "<id>" }
}
```

If any returned proposal is `pending`, `approved`, or `sent`, skip the contact — they already have a draft in flight or were already reached. Don't re-propose; the service will reject you anyway (the pending unique index for a pending draft, an `outreach_conflict` for a sent/approved first-touch), and you'll waste an LLM call. Only `dismissed` (the operator rejected a prior draft) and `failed` (a send that didn't land) leave the contact eligible for a fresh draft.

You may also want to skip when the contact's `lastContactedAt` was within `cadenceRules.maxPerWeekPerContact / 7` days — but for the initial pass, skipping based on an existing non-dismissed proposal is the only hard rule.

## Step 4 — pull product context

The campaign's brief is operator-written intent ("we just shipped a feature for X-shaped customers"). Don't paraphrase claims you can't ground. Use `kb_search` to pull supporting docs:

```jsonc
{ "name": "kb_search", "arguments": { "query": "<keywords from brief>", "limit": 3 } }
```

If `kb_search` returns nothing relevant, your draft must rely strictly on the brief — don't invent features or numbers. If the brief itself is a thin prompt and there's no KB grounding, write the email at a higher level ("we'd like to learn how you're approaching X" rather than "we ship X feature with Y latency").

## Step 5 — draft

Strict rules:

- **Subject** — concrete and specific. 6–12 words. No clickbait, no all-caps. Avoid generic openers ("Quick question?"); reference the brief or the contact's company.
- **Body** — 80–200 words. Personalisation is one short sentence at most ("saw you're at Acme — congrats on the recent funding" only if you can ground it in evidence; otherwise drop it). The rest is brief, the value prop, one direct ask.
- **Format** — plain prose. Bold/italic sparingly for one or two key terms. Bullets are OK for a list of 2–3 short items. **No `#`/`##`/`###` headings.** No tables, no images.
- **JSON literals** — pass real strings with real newlines. Do not stringify the body so it ends up containing `\n` characters.
- **Voice** — second person, plain language, the way an operator would write if they had time.
- **Unsubscribe footer** — do **NOT** include one. The system appends a signed unsubscribe link at approve-time so it can't be tampered with at draft-time.

## Step 6 — file the proposal

```jsonc
{
  "name": "outreach_propose_initial",
  "arguments": {
    "campaignId": "ocmp_…",
    "contactId": "cct_…",
    "draftSubject": "Quick thought on Acme's onboarding loop",
    "draftBody": "Hi Jane,\n\nI noticed Acme just shipped self-serve onboarding — congrats. We help similar B2B teams cut time-to-first-value by ~40% by …",
    "evidence": {
      "kbDocIds": ["kdoc_abc", "kdoc_def"],
      "contactSignals": ["title=Head of Ops", "tag=enterprise"],
      "reasoning": "Brief targets ops leaders; contact title matches; one KB doc on onboarding loops."
    }
  }
}
```

Behavior:

- The proposal lands in `pending` status, visible to the operator on `/dashboard/inbox` (Outreach drafts tab).
- An `outreach.proposal.created` realtime event fires.
- Re-running this skill on the same (campaign, contact) while a pending draft exists, or after a first-touch was already sent/approved, will reject with a conflict — that's the dedup signal.

## Step 7 — review and approve (the operator's loop)

Out of scope for this skill. The operator (or a trusted admin agent acting on their authority) calls `outreach_list_proposals({ status: "pending" })`, reviews each row in the dashboard, then either approves (which sends via the campaign's email channel and creates an outbound conversation) or dismisses with a reason.

## What NOT to do

- **Don't auto-approve.** The plan-level invariant: every outreach email ships through a human-approved gate. If you're tempted to call `outreach_propose_initial` followed by `outreach_approve_proposal`, stop. The latter tool does not exist for the curator; only operators or operator-delegated admin agents reach the approve surface.
- **Don't bypass `crm_list_contacts_in_segment`.** Calling `crm_list_contacts` directly bypasses the suppression+consent floor and will eventually file proposals for someone who already unsubscribed — even if the operator catches it at approve-time, the audit trail looks bad.
- **Don't fabricate facts.** If the brief says "we shipped feature X" and KB has no doc on X, write at a higher level. Better to send a vaguer email than a confidently wrong one.
- **Don't write headings or pseudo-templates.** No `# Hello {name}` or `## About us`. Real emails are plain prose.
- **Don't include an unsubscribe link in the draft body.** The system appends one. If you write your own, the operator will see two and the system one is the only signed/verifiable one.
- **Don't propose a reply.** PR3 ships `outreach_propose_reply` and a separate skill (`skill://outreach/draft-reply-email`). For now, you only file `kind: "initial"`.

## Related

- `skill://kb/review-content` — symmetric pattern (per-conversation curator that proposes, human approves) for KB instead of outreach.
- `skill://crm/clean-contact-data` — population-level dedup that catches duplicates this and other curators create.
- `skill://crm/extract-contact-from-message` — auto-applied (NOT propose-and-review) per-conversation contact creation. The asymmetry vs this skill: extracting what the user typed is faithful transcription; drafting outreach is generative — different risk profiles.
