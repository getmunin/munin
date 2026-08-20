---
title: Look up a person
description: Start from whatever identifier you have — an email address, a phone number, an external id, an analytics visitor id — and find the end-user identity it belongs to, then read what the org already knows about that person across every channel. Use before answering someone, before merging records by hand, or when a CRM lookup came back empty and you need to know whether that means "new person" or "no CRM row yet".
audiences: [admin]
---

# Look up a person

Munin stores the same human in more than one place, and the places are not equivalent.

**`end_users` is the spine.** A row appears the first time someone reaches the org on any channel — an inbound email, a first widget chat, an analytics `identify` call. It is created deterministically, immediately, for everyone.

**`crm_contacts` is derived from it, and it is lossy.** A CRM contact is written by a curator pass (`skill://crm/extract-contact-from-message`) that runs only when a conversation *closes*, and that pass is instructed to decline: it skips mailing lists, auto-replies and bounces, it skips conversations where the person volunteered nothing identifying, and it skips rows that are already fully populated. It also needs a working curator runner.

So `crm_lookup_contact` returning `null` tells you very little. It could mean nobody has ever contacted this org from that address — or it could mean they emailed twenty minutes ago and the conversation is still open. Those are completely different situations and you should not conflate them when you answer someone.

This skill is how you tell them apart.

## TL;DR

1. `identity_resolve` with whatever identifier you have.
2. If `endUserId` is null, the person is genuinely unknown to Munin. Stop and say so.
3. `identity_get({ endUserId })` for the cross-channel picture.
4. Fan out only as far as the question needs: conversations, analytics journey, orders, bookings.

## Step 1 — resolve the identifier

```jsonc
{ "name": "identity_resolve", "arguments": { "email": "jane@acme.com" } }
```

Accepts `email`, `phone`, `externalId`, or `visitorId` — at least one, and it tries them in that order. `matchedOn` in the response tells you which one actually hit, which matters when you passed several and they disagree.

The response also carries `crmContactId`. Read it as a status flag, not as an identifier you need:

- **`endUserId` set, `crmContactId` set** — fully known person. Both surfaces have them.
- **`endUserId` set, `crmContactId` null** — known person, no CRM row *yet*. Very common and completely normal: their conversation is still open, or the extraction pass declined them. Treat them as a returning customer, not a stranger.
- **`endUserId` null** — nobody in this org has ever been in contact from that identifier. This is the only case that means "new person".

`identity_resolve` never creates anything. A miss is a miss; it does not leave a row behind.

## Step 2 — read the whole person

```jsonc
{ "name": "identity_get", "arguments": { "endUserId": "eu_…" } }
```

You get the identity fields plus:

- `channels` — which channel types they have actually written on (`email`, `chat`, `sms`, `voice`). This is the "have they tried to reach us another way?" answer.
- `conversationCount`, `lastConversationAt` — history depth and recency.
- `visitorIds` — their linked anonymous browsing identities.
- `viewEventCount`, `searchEventCount` — how much analytics history exists, so you know whether a journey call is worth making.
- `crmContactId`, `convContactId` — the ids of their records on the other two surfaces.

## Step 3 — fan out, but only as far as the question needs

Each of these is a separate call and some are slow. Pick by what you were actually asked.

- **Their history with us** — `conv_list_conversations({ endUserId })`. Spans every channel, unlike filtering by a single conversation's contact.
- **What they were reading before they wrote in** — `analytics_get_contact_journey({ endUserId })`. Worth calling when `viewEventCount` is non-zero; it includes the anonymous history from before the identity link was established.
- **Their CRM record** — `crm_get_contact` with the `crmContactId` from step 1 or 2, when you need consent flags, deals, or activity.
- **Orders and bookings** — `commerce_list_customer_orders` and `bookings_list_guest_bookings`, keyed on the `email` from step 1.

`identity_get` deliberately does *not* include orders or bookings. Those live in the customer's own store or booking vendor and are read live over the network, so folding them in would make every identity lookup slow and make it fail whenever a vendor is down. Fetch them separately, only when the question is about an order or a booking.

## Reading the result honestly

- **A null `crmContactId` is not "unknown person".** Say "I can see your previous emails" when `conversationCount` is non-zero, whatever the CRM says.
- **Don't merge by hand.** If one human clearly holds two identities — two addresses, same signature — say so and stop. There is no end-user merge tool yet, and writing a CRM merge proposal does not merge the browsing history underneath it.
- **`identity_resolve` is admin-only, on purpose.** It turns any address into a lookup of that person's history, which is fine for an operator working inside their own org and is exactly what the self-service tools are built to prevent. Don't reach for it to answer a question an end-user asked about someone else.

## Related

- `skill://crm/extract-contact-from-message` — the curator pass that creates the CRM contact this skill reports the absence of.
- `skill://analytics/identify-visitors` — how a browsing visitor gets linked to an end-user identity in the first place.
- `skill://crm/clean-contact-data` — population-level duplicate merging, at the CRM layer only.
