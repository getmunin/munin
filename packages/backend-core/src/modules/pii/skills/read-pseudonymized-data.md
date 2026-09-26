---
title: Read pseudonymized personal data
description: What the tokens and masks in a pseudonymized tool result mean, how complete the pseudonymization is, and what you can still do with it.
audiences: [admin]
---

# Read pseudonymized personal data

Use this when a tool result contains `[Contact …]` tokens, `…@pseudonym.invalid` addresses, or masks such as `[NAME]` — or when an operator asks you to analyse conversations, contacts or orders without seeing who the customers are.

## TL;DR

1. Check whether this connection pseudonymizes: pseudonymized results carry a second text block starting "Personal data in this result is pseudonymized", and `_meta["munin/pii"]`.
2. Treat each `[Contact abcd2345]` token as one real person. The same person has the same token in every result, across conversations, CRM, commerce and bookings.
3. Read `coverage`. `complete` means every detection layer has run over what you are looking at; `pending` means a name the org has never seen may still appear in message text.
4. Bulk exports (`conv_export`, `crm_export`, `kb_export`, `cms_export`, `outreach_export`, `analytics_export_events`) are refused on a pseudonymized connection. They are migration tools, and an export full of tokens would corrupt whatever imports it.

## Why results are pseudonymized

Munin hands your MCP client the org's data, and most of it was written by the org's customers. An operator who wants you to find patterns across thousands of messages rarely needs you to know who wrote them. So external connections get personal data replaced before the result leaves the server, while the org's own support agent — which has to write "Hei Kari" — keeps the real text.

Whether a connection sees raw data is the operator's decision, made when the connection is authorized: the OAuth consent screen has a "Share personal data as stored" box, unticked by default, and an API key is minted either pseudonymized or raw. Raw access is the `pii:raw` scope, and an org can require pseudonymization for every connection regardless of what it was granted. You cannot change it from a tool call — if a task genuinely needs real names or contact details, tell the operator it needs a connection with raw access.

## What replaces what

| You see | It stands for |
|---|---|
| `[Contact abcd2345]` | a person the org already knows — a CRM contact, a conversation contact or an end user — by name |
| `contact-abcd2345@pseudonym.invalid` | the same person's email address |
| `[Phone abcd2345]` | the same person's phone number |
| `[NAME]` | a person name that is not linked to a known contact, or that more than one contact shares |
| `[EMAIL]`, `[PHONE]` | an address or number that belongs to no known contact |
| `[NATIONAL_ID]` | a Norwegian, Swedish or Danish national identity number |
| `[BANK_ACCOUNT]`, `[CARD_NUMBER]` | an IBAN or Norwegian account number, a payment card number |

The token is the stable part: `[Contact abcd2345]`, `contact-abcd2345@pseudonym.invalid` and `[Phone abcd2345]` are one person. Masks are not stable: two `[NAME]`s may or may not be the same person.

Record ids (`cct_…`, `ccv_…`, `cvm_…`) are never pseudonymized. Use them to open the same record again, or to follow a contact from a conversation into CRM.

## Coverage

Names the org already holds, and every email, phone number, national ID and bank or card number, are replaced in every result, immediately. Names the org has never seen — a colleague or family member mentioned in a message — are found by a separate name-detection worker that works through messages in the background, if the deployment runs one.

`_meta["munin/pii"].coverage` tells you where a result stands:

- `complete` — every layer that is switched on has run over the messages in this result.
- `pending` — name detection is switched on but has not reached some of these messages yet. Known contacts and identifiers are still replaced; a third party mentioned by name in the text may not be.

`layers` lists what ran: `deterministic` (identifiers), `directory` (the org's own contacts), and `ner` (the name-detection worker) when it is enabled.

When you report findings from `pending` results, say so. Do not quote free text from them as if it were fully anonymized.

## Passing tokens back

Tokens are accepted anywhere a tool takes a name, email address or phone number. The server swaps in the real value before the tool runs, so:

- `crm_lookup_contact` with `email: "contact-abcd2345@pseudonym.invalid"` finds the contact.
- `commerce_list_customer_orders` or `bookings_list_guest_bookings` with that address looks up the person's orders or bookings.
- A reply drafted as "Hei [Contact abcd2345], …" reaches the customer with their real name.

What comes back is pseudonymized again. Masks such as `[NAME]` or `[EMAIL]` cannot be passed back: they stand for nothing the server can resolve.

## Working with it

- **Count and compare by token.** "`[Contact abcd2345]` wrote four times about the same late delivery" is a finding you can make and the operator can act on.
- **Follow a person across modules.** A token from a conversation is the same token in `crm_get_contact` and in order results, and you can pass it to either.
- **Hand the token back to a human.** An owner or admin can look a token up under Settings → Privacy, and the dashboard shows real data throughout. Do not try to work out who is behind a token from the surrounding text, and do not ask the operator to paste the raw data into the conversation.
- **Keep masks as masks.** Don't guess the name behind a `[NAME]` and don't fill it in.
