---
title: CRM: Repair an undeliverable address
description: Handle an email address mail can no longer reach — read the deliverability state on a contact, record a dead address so outreach stops sending, find the person's new address, and reopen the address once it works again. Deliverability is reachability, not consent; never fix it with do_not_contact.
audiences: [admin]
---

# Repair an undeliverable address

People change jobs. Mailboxes get deleted. An address that worked last quarter starts bouncing, and outreach keeps mailing it once a week until somebody notices.

Munin tracks that as a property of the **address**, separate from consent. A contact carries `doNotContact` and `unsubscribedAt` — those say *we may not mail this person*. An address carries a deliverability state — it says *we cannot reach them here*. The two move independently, and conflating them causes real damage: marking a dead address as `do_not_contact` suppresses the person forever, on every channel, including after a colleague hands you their new address.

## The states

`crm_get_contact` returns a `deliverability` object on the contact, or `null` while the address is fine:

| State | Meaning |
|---|---|
| `valid` | Reachable. Also what a cleared address looks like. |
| `soft_failing` | Something failed once, but the evidence is weak or could be temporary — a full mailbox, a weekend outage, a "this mailbox is no longer available" autoresponder. Outreach still sends. |
| `undeliverable` | Mail does not arrive. Outreach refuses to propose or send to this address. |

`reason` records which rule fired:

| Reason | Set by |
|---|---|
| `hard_bounce` | A delivery-status report or `X-Failed-Recipients` header naming this recipient. |
| `smtp_rejected` | The send died against a permanent recipient rejection (`5.1.x`, "user unknown"). |
| `delivery_dead` | The send exhausted its retries against a mailbox-level problem — a full mailbox, say. Soft. A send that died on our side of the wire (bad credentials, an unreachable host, a content-policy rejection) says nothing about the address and records nothing. |
| `no_reply_notice` | A no-reply autoresponder answered a thread with this contact. Soft, and prose — it wants corroboration. |
| `repeated_soft_failure` | Three soft failures inside 30 days. The window resets, so a bad weekend does not accumulate into a verdict. |
| `manual` | You or an operator said so. |
| `cleared` | Someone set it back to `valid` after fixing the address. |

Only `hard_bounce`, `smtp_rejected`, `repeated_soft_failure` and `manual` reach `undeliverable`. Soft signals never condemn an address on their own.

## When outreach refuses

An outreach tool that would mail a dead address fails with `outreach_undeliverable: mail cannot reach <address> …`. That is a different error from `outreach_invalid: contact … is suppressed or has no recorded lawful basis`, and the difference matters:

- `outreach_invalid` about suppression means **permission** is missing. Do not work around it. The person opted out, or nobody recorded a lawful basis.
- `outreach_undeliverable` means **reachability** is missing. The person never said no — you just have the wrong address. Go find the right one.

## Handling a dead address

1. **Confirm what you are looking at.** `crm_get_contact` on the contact, or `crm_list_address_deliverability` for the whole backlog. Read `reason` and `evidence` — `evidence.conversationId` points at the bounce or notice that set it.
2. **Look for a replacement.** `crm_search_contacts` for the same person at another address, `crm_list_contacts({ companyId })` for a colleague who can tell you, and `conv_search_messages` for a signature or a forward that names the new mailbox. A reply on the original thread often carries it.
3. **If you find a new address**, update the contact with `crm_update_contact({ id, patch: { email } })`. The old address keeps its state — which is the point; if the person ever comes back to it, the record is still there.
4. **If you cannot find one**, leave the state as it is and log what you tried with `crm_log_activity`. Do **not** set `doNotContact`. A dead address is not an opt-out, and the next person to look at this contact needs to be able to tell the difference.

## Recording one yourself

When you learn from a conversation that an address is dead — an autoresponder, a colleague saying "she left us in March" — record it:

```jsonc
{
  "name": "crm_set_address_deliverability",
  "arguments": {
    "address": "old.name@example.com",
    "state": "undeliverable",
    "note": "Employer autoresponder on conv #186: mailbox no longer exists"
  }
}
```

Write what you actually saw in `note`. The next agent reads it to decide whether the verdict still holds.

## Reopening one

Once the address works again — it was a typo, the mailbox was restored, the person confirms it:

```jsonc
{
  "name": "crm_set_address_deliverability",
  "arguments": {
    "address": "old.name@example.com",
    "state": "valid",
    "note": "Typo — corrected to .no, test send delivered"
  }
}
```

That resets the state to `valid` and zeroes the failure count, so the soft-failure window starts clean. It is the whole reason this lives on the address rather than on the contact: a door that opens both ways.

## What not to do

- **Don't set `doNotContact` to stop mail to a dead address.** That records an opt-out that never happened, and it is far harder to undo — it suppresses every channel, forever, for the person rather than for the address.
- **Don't set an address back to `valid` just to get past `outreach_undeliverable`.** Reopen it when you have a reason to believe it works. If you are guessing, fix the address instead.
- **Don't read a soft failure as proof.** One `no_reply_notice` or one `delivery_dead` is a hint. Corroborate before you call it dead — or leave it, and let the three-in-thirty-days rule decide.
