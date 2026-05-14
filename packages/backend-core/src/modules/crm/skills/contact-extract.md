---
title: CRM contact extraction
description: When a conversation closes, read the thread for identifying info the end-user volunteered (name, email, phone, company, title) and persist it to the CRM as a contact — auto-applied, no proposal queue. Designed to fire on every `conversation.closed` event so visitor-volunteered identity becomes structured CRM data without operator intervention.
audiences: [admin]
---

# CRM contact extraction

People volunteer identity in chat. "Hi, this is Jane from Acme — could you …", "ping me at jane@acme.com", "my number is +47 555-1234". That information is the difference between a row called "anonymous visitor #4912" and a real CRM contact you can re-engage later. Your job is to read one closed conversation, extract whatever the end-user actually said about themselves, and write it through to the CRM — no proposal queue, no review step. The data source is the user's own message; if they typed it, that's authoritative enough.

A separate, scheduled `skill://crm/hygiene` curator runs weekly to merge any duplicates this pass creates (e.g. visitor gives email in conv #1 and phone in conv #2 with no overlap). Don't try to do hygiene's job here — keep the per-conversation pass narrow.

## TL;DR

1. **Read the conversation** with `conv_get_conversation(<conversationId>)`. The user prompt names the conversation; do not list or scan others.
2. **Check the first end-user message's `metadata.senderClassification`** (email channel only). If `isMailingList`, `isAutoReply`, or `isBounce` is true → skip the conversation entirely, no writes. These aren't real people we should be CRM-tracking.
3. **Extract identifying fields** from `end_user`-authored messages only: `email`, `phone`, `name`, `companyId`/`companyName`, `title`. Ignore agent and system messages — those are operator output, not user-volunteered identity. **For email messages, also read `metadata.signatureText`** — the trailing block already pulled out of the body. Signatures are the strongest identity source we have (the sender themselves typed it as their canonical "this is who I am") and should take precedence over inline mentions in the body.
4. **Skip if nothing identifying was said.** If you found neither email nor phone nor a clear self-introduced name, finish silently — no writes.
5. **Look up an existing contact** with `crm_find_contact({ email?, phone? })` before creating. Match keys: extracted email or phone.
6. **Create or backfill, never overwrite.** If `crm_find_contact` returns null → `crm_create_contact` with the extracted fields and the conversation's `endUserId`. If it returns an existing row → `crm_update_contact` and ONLY fill fields that are currently null/empty on the existing row. Do not overwrite a non-empty field.
7. **Stop.** One `crm_create_contact` or one `crm_update_contact`. No further actions.

### Role accounts (email only)

When `metadata.senderClassification.isRoleAccount` is true on the first end-user message, the address is a shared inbox (`support@`, `sales@`, `info@`, `noreply@`, …) — not a person. Extract `email` only; **do not** write `name`, `title`, or `phone` from the signature or the body, because those fields rotate week to week as different humans answer the inbox. Tag with `from-chat` and `role-account` so operators can filter or merge later.

## Step 1 — read the conversation

```jsonc
{ "name": "conv_get_conversation", "arguments": { "id": "ccv_…" } }
```

The response includes `messages[]`. The conversation summary also has `endUserId` — note it; you'll pass it on `crm_create_contact` so the new contact links back to the conversation participant.

## Step 2 — extract from end-user messages

Only consider `authorType: "end_user"` messages. Look in two places, in priority order:

1. **`metadata.signatureText` (email channel only).** A signature block is the sender's own canonical self-description — a strong identity claim. Parse it as a structured block: name on its own line (sometimes preceded by a closing like "Best,"), then any combination of title, company, address, phone, email, website. Lines like "Sent from my iPhone" carry no identity; ignore them.
2. **Inline body mentions** ("Hi, I'm Jane from Acme", "ping me at +47 …"). Same rules as before — only self-referential, not third-party routing instructions.

For each field:

- **Email** — From-address (`conv_get_conversation` returns it on the conversation; it's the From of every end-user email). Inline mentions are secondary. Skip emails that look like third parties they're forwarding to ("send it to legal@partner.com").
- **Phone** — signature first, then inline. Normalise to E.164 if you can infer the country from context; otherwise keep as typed.
- **Name** — signature first (the line right after the closing, e.g. "Best,\nJane Doe"). Otherwise only when the user explicitly self-introduces ("I'm Jane", "this is Jane Doe"). Don't infer from email local-part — `j.doe@acme.com` doesn't tell you they're "Jane Doe". Don't pick up names of third parties they're discussing.
- **Title / company** — signature first (typical layout: name → title → company). Otherwise only when self-stated ("I'm head of ops at Acme"). Don't infer company from email domain alone unless they also self-introduce: "I'm Jane from Acme" + `jane@acme.com` is fine, just `jane@acme.com` is not.

If a message contains "send to support@example.com please" and nothing self-referential, **skip the email** — that's a routing instruction, not an identity claim.

### Reading the signature block

`metadata.signatureText` is the raw block as the sender typed it. A typical shape:

```
Best regards,
Jane Doe
Head of Operations
Acme Corp
+1 555 123 4567
jane@acme.com
```

Parse line by line. The first non-closing line is the name. Subsequent lines are some mix of title, company, phone, email, address — order varies. Be conservative on ambiguous lines (e.g. "London" alone — is that an address fragment? a city? skip it).

## Step 3 — when to skip entirely

- The first end-user message's `metadata.senderClassification` has `isMailingList`, `isAutoReply`, or `isBounce` set to true → skip. These are not human correspondents.
- No email AND no phone AND no clear self-introduced name → skip, no writes.
- Conversation has no `endUserId` (channel doesn't track participants) → skip; nothing to attribute the contact to.
- The conversation's `endUserId` already maps to a `crm_contacts` row (via `endUserId` join) AND that row already has email + phone + name populated → skip, nothing to backfill.

## Step 4 — dedupe before creating

```jsonc
{ "name": "crm_find_contact", "arguments": { "email": "jane@acme.com" } }
```

Or by phone if no email. If `crm_find_contact` returns `null`, you'll create a new contact in step 5. Otherwise, you'll backfill.

If you have BOTH email and phone, run `crm_find_contact` for email first; if no hit, run for phone. The first hit wins.

## Step 5a — create (no existing match)

```jsonc
{
  "name": "crm_create_contact",
  "arguments": {
    "name": "Jane Doe",
    "email": "jane@acme.com",
    "phone": "+47 555-1234",
    "title": "Head of Ops",
    "endUserId": "eu_...",
    "tags": ["from-chat"]
  }
}
```

Pass only the fields you actually extracted. Always include `endUserId` (the conversation's participant) so the contact is linked back to the chat surface — the dashboard's conversation view uses that link to show "this person's CRM record".

Add the `from-chat` tag so operators can filter contacts that came in via this curator.

## Step 5b — backfill (existing match found)

```jsonc
{
  "name": "crm_update_contact",
  "arguments": {
    "id": "cct_existing",
    "patch": { "phone": "+47 555-1234", "title": "Head of Ops" },
    "mode": "fill-null"
  }
}
```

**Always pass `mode: "fill-null"`** from this skill. That tells the service to apply patch keys only where the existing contact's field is null/empty; non-null fields are left untouched server-side. This is defense-in-depth on top of your own filtering — if you accidentally include a field that's already populated, the service refuses to overwrite rather than clobbering operator-curated data.

You should still pre-filter the patch yourself (it's cleaner and avoids a no-op write): read the row from `crm_find_contact`'s response and, for each extracted field:

- existing field is `null` or empty string → include it in `patch`
- existing field has a value → leave it out of `patch`, even if the user's new value looks "better"

If every extracted field is already populated, finish silently without calling `crm_update_contact` at all.

## What NOT to do

- **Don't overwrite human-curated data.** The operator typed something, then the user typed something different in chat — trust the operator. Backfill empty fields only.
- **Don't extract from agent messages.** "Sure, jane@acme.com is on file" is the agent quoting back something it remembers; treating it as an identity claim creates feedback loops.
- **Don't infer.** `j.doe@acme.com` does not mean their name is "Jane Doe" or "John Doe". Names come from explicit self-introduction; everything else stays null.
- **Don't propose merges.** That's `skill://crm/hygiene`'s job and runs weekly across the whole population. Per-conversation extraction is narrow on purpose.
- **Don't open multiple records.** One contact per pass — either one create or one update, never both.

## Related

- `skill://crm/hygiene` — population-level merge pass that catches dupes this skill missed (e.g. visitor gave email in one conv, phone in another).
- `skill://kb/curation` — the symmetric pattern: per-conversation event-driven extraction, but for KB candidates instead of CRM contacts. Note that KB *proposes* (because LLM-drafted facts can be wrong); CRM contact extraction *auto-applies* (because the data source is the user's own typed words).
