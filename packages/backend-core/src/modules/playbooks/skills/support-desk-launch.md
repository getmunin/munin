---
title: Playbook: Support desk launch (Conv + CRM + KB)
description: Stand up a working support desk for a new tenant — channels, contacts, knowledge base — so the first ticket has tooling around it.
audiences: [admin]
public: true
---

# Support desk launch (Conv + CRM + KB)

A new customer wants Munin to be their support desk. They need: an email channel and chat widget for tickets, a CRM with their existing customers loaded, and a KB their support team (or AI agents) can search to answer common questions.

This playbook orchestrates three module-level setups. Each step links to the per-module skill — don't reproduce the detail here.

## TL;DR

1. **Conv channels** (`skill://conv/setup-email-and-widget-channels`) — email + widget, both tested.
2. **CRM contacts** (`skill://crm/import-and-score-leads` or `skill://crm/onboard-new-customer`) — import existing customers so inbound conversations auto-link.
3. **KB seed** (`skill://kb/create-first-space` + `skill://kb/import-articles-in-bulk`) — first space + initial article set.
4. Verify the loop end-to-end: send a test inbound message → confirm it lands → confirm contact auto-link → confirm an agent can find a relevant KB article.

## Prerequisites

This playbook assumes:
- The org exists and has at least one admin API key.
- The customer has provided SMTP/IMAP creds OR is OK using Munin's mailer.
- The customer has provided their existing customer list (CSV/JSON) — or they're starting fresh.
- The customer has a content source for KB seeding (Google Doc, Zendesk export, internal wiki).

If any prerequisite is missing, stop and ask for the missing input rather than guessing.

## Step 1 — channels

Follow `skill://conv/setup-email-and-widget-channels` end-to-end. At completion you should have:
- An email channel with SMTP+IMAP verified.
- A widget channel with `widgetKey` handed to the customer's dev team.
- Default topics seeded (Billing / Support / Bug, or custom).

`conv_list_channels` should return both as `active: true`.

## Step 2 — CRM seed

Two flavors depending on what the customer hands you:

### Bulk list (most common for migrations)

Follow `skill://crm/import-and-score-leads`. Skip the deal-creation step (or move it later) — for support desk seeding, the goal is *contact existence*, not pipeline placement.

Companies: if the customer's list has company info, create them via `crm_create_company` and link via `crm_update_contact`. Auto-linking inbound emails to companies is a future improvement; today the link is by `companyId` on the contact.

### One at a time

If they want to onboard customers as they reach out, follow `skill://crm/onboard-new-customer` per inbound conversation instead.

## Step 3 — KB seed

### First space

Follow `skill://kb/create-first-space`. For a support desk:
- Pick a space slug like `help` or `support-kb`.
- Decide whether articles will be `public: true` (delivered via the self-service search audience to end-users) or `public: false` (admin-side only, for human agents).

### Article import

Follow `skill://kb/import-articles-in-bulk` for the customer's existing knowledge. Read `skill://kb/import-from-google-docs` first if you haven't — chunking strategy matters for search performance.

If the customer doesn't have any existing knowledge to import: ask for 5–10 of the most-asked questions and write articles inline via `kb_create_document`. Even a small starter set lets agents (human and AI) cite something.

## Step 4 — end-to-end smoke test

Send a test inbound message to verify the full loop:

### Email

From a known external mailbox, send to the configured `fromAddress` (e.g. `support@customer.com`). Within ~1 polling interval (`InboundPollWorker` runs frequently when `inbound: poll` is configured):

```jsonc
{ "name": "conv_list_conversations", "arguments": { "limit": 5 } }
```

The new conversation should appear. Check that `contactId` resolved if the sender's email matches a CRM contact.

### Widget

From a browser on an allowlisted origin, post a message via the widget API. Confirm with `conv_get_conversation` that the message lands.

### KB search from inside a conversation

For an admin agent reading the conversation, `kb_search` should surface a relevant article:

```jsonc
{ "name": "kb_search", "arguments": { "query": "<phrase from the test message>", "limit": 5 } }
```

If nothing relevant comes back, either the import didn't include this topic or chunking was too coarse — both are fixable but worth noticing now.

## What NOT to do

- **Don't seed an empty KB.** Even a half-dozen of the most-asked questions transforms the support agent's experience. Empty KB = agents fall back to free-text generation, which is slower and less consistent.
- **Don't import the customer's full historical contact list as one bulk action without a tag.** If the import turns out to have bad data, you can't easily filter it back out. Tag every imported contact with the import batch (`tags: ["initial-import-2026-05"]`).
- **Don't skip the smoke test.** Channels look configured but actually fail under real traffic — IMAP polling timing, widget origin enforcement, AI summary worker pickup. Sending one real message exercises the full pipeline.
- **Don't enable widget channels with an empty `originAllowlist`.** Anyone with the key can post; that's fine for staging but never in production.

## Related

- `skill://conv/setup-email-and-widget-channels` — the channels half.
- `skill://crm/import-and-score-leads` — bulk contact import.
- `skill://crm/onboard-new-customer` — single-contact path.
- `skill://kb/create-first-space` — first KB space.
- `skill://kb/import-articles-in-bulk` — bulk article import.
- `skill://kb/import-from-google-docs` — chunking + embeddings.
- `skill://playbooks/customer-acquisition` — outbound (sales) flavor of conv + crm.
