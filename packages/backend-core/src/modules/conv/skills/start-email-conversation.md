---
title: 'Conv: Start an email conversation'
description: Write to someone by email address when nobody has written in yet — a new thread from one of the org's email channels, sent at once by a person or parked as a draft when an agent starts it.
audiences: [admin]
---

# Start an email conversation

Use this when the operator wants to email someone who has no conversation open yet: follow up on a phone call, answer a question that came in somewhere Munin doesn't see, tell a customer their order is delayed. The result is an ordinary email conversation — replies thread back into it and the org's agent and inbox handle them like any other.

This is for one person at a time. Sending the same message to a list is outreach (`outreach_create_broadcast`, or a campaign), which applies consent, unsubscribe links and the org's send rules.

## TL;DR

1. `conv_list_channels` if you don't know which email channel should send. Skip it when the org has a single email channel.
2. Check there isn't already a thread with this person: `conv_list_conversations` with `search` set to the address.
3. `conv_start_email_conversation` with `email`, `subject`, `body` (and `channelId` when there is more than one email channel).
4. Read `delivery` in the result and tell the operator what happens next.

## Step 1 — pick the channel

The message goes out from an email channel's address, and replies come back to that mailbox. When the org has exactly one active email channel you can leave `channelId` out. With two or more (say `support@` and `sales@`), the tool refuses until you pass one — pick the mailbox the recipient should reply to, and ask the operator when that isn't obvious.

## Step 2 — avoid a second thread

Every call starts a **new** conversation, even when the address already has one. If the person already has an open thread about the same subject, reply in it with `conv_send_message` instead — two threads about one thing splits the history and confuses the customer.

## Step 3 — write and start it

```jsonc
// conv_start_email_conversation
{
  "email": "kari.nordmann@example.com",
  "name": "Kari Nordmann",
  "subject": "Your booking on Friday",
  "body": "Hi Kari,\n\nThanks for calling earlier. ..."
}
```

- `subject` is required. A cold email with no subject reads as spam, and it is the subject replies are matched under.
- `name` is only used when the address has no contact yet; an existing contact keeps its name.
- `topicId` (from `conv_list_topics`) files the conversation under a topic from the start.
- Write the body as the email itself, in the recipient's language. Plain text with blank lines between paragraphs; markdown links and emphasis render.

The address is refused when its CRM contact is marked do-not-contact, or when mail to it is known to bounce (`crm_list_address_deliverability`). Don't route around either — tell the operator, who can fix the address or clear its state.

## Step 4 — what happens next

The result carries the new `conversation` and a `delivery` value:

| `delivery` | Who called | What it means |
|---|---|---|
| `queued` | A signed-in person | The email is on its way. The conversation shows the sent message. |
| `awaiting_approval` | An agent (API key or the org's own agent) | Nothing was sent. The message is a draft on the new conversation and goes out when a person approves it in the inbox. |

An agent can't send a first email on its own, whatever the channel's agent mode: an `auto` channel lets the agent answer people who wrote in, not write to any address it picks. When you get `awaiting_approval`, say so plainly — "I've drafted it for you to approve in the inbox" — and don't call the tool again to retry; a second call creates a second conversation with a second draft.
