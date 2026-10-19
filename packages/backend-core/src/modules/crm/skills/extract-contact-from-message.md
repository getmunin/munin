---
title: CRM: Extract a contact from a message
description: When a conversation closes, read the thread for identifying info the end-user volunteered about themselves (name, email, phone, title) and record it on that conversation's own CRM contact with `crm_apply_conversation_identity` — auto-applied, no proposal queue. Designed to fire on every `conversation.closed` event so visitor-volunteered identity becomes structured CRM data without operator intervention.
audiences: [admin]
---

# Extract a contact from a message
People volunteer identity in chat. "Hi, this is Kari from Acme — could you …", "ping me at kari@example.no", "my number is +47 12 34 56 78". That information is the difference between a row called "anonymous visitor #4912" and a real CRM contact you can re-engage later. Your job is to read one closed conversation, extract whatever the end-user actually said about themselves, and record it with a single tool call — no proposal queue, no review step.

A separate, scheduled `skill://crm/clean-contact-data` curator runs weekly to merge any duplicates this pass creates (e.g. visitor gives email in conv #1 and phone in conv #2 with no overlap). Don't try to do hygiene's job here — keep the per-conversation pass narrow.

## TL;DR

1. **Read the conversation** with `conv_get_conversation(<conversationId>)`. The user prompt names the conversation; this pass can only read that one.
2. **Check the first end-user message's `metadata.senderClassification`** (email channel only). If `isMailingList`, `isAutoReply`, or `isBounce` is true → skip the conversation entirely, no writes. These aren't real people we should be CRM-tracking.
3. **Extract identifying fields** from `end_user`-authored messages only: `name`, `email`, `phone`, `title`. Ignore agent messages, system messages and internal notes — those are operator output, not user-volunteered identity. **For email messages, also read `metadata.signatureText`** — the trailing block already pulled out of the body. A signature is the sender's own canonical "this is who I am" and takes precedence over inline mentions in the body.
4. **Skip if nothing identifying was said.** If you found neither email nor phone nor a clear self-introduced name, finish silently — no writes.
5. **Record it** with one `crm_apply_conversation_identity` call carrying the conversation id and the fields you extracted.
6. **Stop.** One call, no further actions.

## What the tool decides for you

`crm_apply_conversation_identity` picks the contact and the fields server-side, so you never look a contact up or choose one:

- **Which contact.** The contact already linked to the conversation's end-user; otherwise an unlinked contact matching an email or phone the conversation has *proven* (an address the channel or the org attested, on a conversation whose messages neither failed DMARC nor arrived forwarded); otherwise a new contact linked to the end-user and tagged `from-chat`. An address someone merely typed in chat never selects an existing contact.
- **Which fields.** Only empty fields are filled. A value already on the contact stays, even when the user typed something different — the operator's data wins. Tags, owner, custom fields and do-not-contact status are never touched.
- **Unproven identifiers.** An email or phone the conversation has not proven is still recorded on the conversation's own contact, unless another contact already holds it — then it is dropped rather than attached or duplicated.
- **Automated senders.** Mailing-list, auto-reply and bounce senders are skipped. A role-account sender (`support@`, `sales@`, `noreply@`, …) records its email only, tagged `role-account`, because the name, title and phone behind a shared inbox rotate week to week.

The result says what happened: `action` is `created`, `filled`, `unchanged` or `skipped` (with a `reason`), plus the `contactId` and the `fields` written. Any of them is a finished pass.

## Step 1 — read the conversation

```jsonc
{ "name": "conv_get_conversation", "arguments": { "id": "ccv_…" } }
```

The response includes `messages[]`. Use the id from the user prompt; a different id is refused.

## Step 2 — extract from end-user messages

Only consider `authorType: "end_user"` messages that are not internal. Look in two places, in priority order:

1. **`metadata.signatureText` (email channel only).** Parse it as a structured block: name on its own line (sometimes preceded by a closing like "Best,"), then any combination of title, company, address, phone, email, website. Lines like "Sent from my iPhone" carry no identity; ignore them.
2. **Inline body mentions** ("Hi, I'm Kari from Acme", "ping me at +47 …") — only self-referential statements, not third-party routing instructions.

For each field:

- **Email** — the sender's From address for email conversations; you may omit it, since the tool falls back to the conversation's proven address. Inline mentions are secondary. Skip emails that belong to third parties they're forwarding to ("send it to legal@example.com").
- **Phone** — signature first, then inline. Normalise to E.164 if you can infer the country from context; otherwise keep it as typed (digits, spaces and `+ ( ) . -` only).
- **Name** — signature first (the line right after the closing, e.g. "Best,\nKari Nordmann"). Otherwise only when the user explicitly self-introduces ("I'm Kari", "this is Kari Nordmann"). Don't infer from the email local-part — `k.nordmann@example.no` doesn't tell you their first name. Don't pick up names of third parties they're discussing.
- **Title** — signature first (typical layout: name → title → company). Otherwise only when self-stated ("I'm head of ops at Acme").

If a message contains "send to support@example.com please" and nothing self-referential, **skip the email** — that's a routing instruction, not an identity claim.

### Reading the signature block

`metadata.signatureText` is the raw block as the sender typed it. A typical shape:

```
Best regards,
Kari Nordmann
Head of Operations
Acme
+47 12 34 56 78
kari@example.no
```

Parse line by line. The first non-closing line is the name. Subsequent lines are some mix of title, company, phone, email, address — order varies. Be conservative on ambiguous lines (e.g. "London" alone — an address fragment? a city? skip it).

## Step 3 — when to skip entirely

- The first end-user message's `metadata.senderClassification` has `isMailingList`, `isAutoReply`, or `isBounce` set to true.
- No email, no phone, and no clear self-introduced name.

## Step 4 — record

```jsonc
{
  "name": "crm_apply_conversation_identity",
  "arguments": {
    "conversationId": "ccv_…",
    "name": "Kari Nordmann",
    "email": "kari@example.no",
    "phone": "+4712345678",
    "title": "Head of Operations"
  }
}
```

Pass only the fields you actually extracted. Call it once, then stop.

## What NOT to do

- **Don't extract from agent messages or internal notes.** "Sure, kari@example.no is on file" is the agent quoting back something it remembers; treating it as an identity claim creates feedback loops.
- **Don't infer.** `k.nordmann@example.no` does not mean their name is "Kari Nordmann". Names come from explicit self-introduction; everything else stays out.
- **Don't record other people.** A colleague, a manager, or anyone else mentioned in the thread is not the end-user, whatever the message asks for.
- **Don't propose merges.** That's `skill://crm/clean-contact-data`'s job and runs weekly across the whole population.

## Related

- `skill://crm/clean-contact-data` — population-level merge pass that catches dupes this skill missed (e.g. visitor gave email in one conv, phone in another).
- `skill://kb/review-content` — the symmetric pattern: per-conversation event-driven extraction, but for KB candidates instead of CRM contacts. Note that KB *proposes* (because LLM-drafted facts can be wrong); CRM contact extraction *auto-applies*, because the tool only fills empty fields on the conversation's own contact.
