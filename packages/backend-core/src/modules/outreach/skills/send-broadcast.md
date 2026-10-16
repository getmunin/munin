---
title: Send a broadcast to a segment
description: Draft one email for every eligible contact in a CRM segment, such as a changelog, newsletter or announcement. Check who it reaches and who is excluded, send a test to a teammate, and hand it to a signed-in person to approve. Then follow delivery, replies and unsubscribes. Agents draft and monitor; only a person approves the send.
audiences: [admin]
---

# Send a broadcast to a segment

A broadcast is one approved message sent to everyone eligible in a CRM segment. A campaign is the opposite: it drafts a personal email for each contact and approves them one by one. Use a broadcast when everyone should read the same thing, like a product changelog, a newsletter, or a policy or pricing notice. Use a campaign when the message should differ per person.

**You draft; a person approves.** `outreach_approve_broadcast` refuses agents and API keys. Only someone signed in to the Munin dashboard (or clicking approve in the Munin panel) can approve. A broadcast reaches hundreds or thousands of inboxes at once and cannot be recalled, so that gate is the point. Don't retry the approval, and don't look for a credential that works. When the draft is ready, say it is waiting for approval and stop.

**What every recipient gets, without you adding it:** a personal unsubscribe link in the template footer, and one-click unsubscribe headers that Gmail, Yahoo and Outlook show as their own unsubscribe button. Unsubscribing sets the contact's `unsubscribedAt` and `doNotContact`, which stops all outreach to them, campaigns included. Support replies are not affected.

## Who receives it

The audience is the segment's contacts minus everyone who can't lawfully or physically receive it. `outreach_create_broadcast` and `outreach_get_broadcast` report it under `audience`:

- `eligible`: how many people it goes to, with a few `sample` recipients.
- `excluded`, counted per reason:
  - `unsubscribed` / `do_not_contact`: they opted out or were blocked. Never work around this.
  - `no_lawful_basis`: no recorded consent, contract or legitimate interest. See below.
  - `no_email`: the contact has no usable address.
  - `undeliverable`: mail to the address bounced (see `skill://crm/repair-undeliverable-address`).
  - `duplicate_address`: two contacts share an address. They get one copy.

**Lawful basis is the operator's call.** If `no_lawful_basis` is large, tell the operator how many contacts it covers and ask what basis applies. A changelog to paying customers is usually `contract`; a newsletter to people who signed up is `consent`. Record it with `crm_set_contact_consent` only after they confirm, and include the `source` they give you. Never infer consent from the fact that someone is in the CRM.

**Approval freezes the audience.** The recipient list is taken when the broadcast is approved. Contacts who join the segment afterwards are not added. Just before each email goes out, the worker re-checks that person and skips them (`skipped`, with a `skipReason`) if they unsubscribed, were blocked, lost their lawful basis or became undeliverable in the meantime.

## Procedure

1. **Pick the segment.** `crm_list_segments`, or create one with `crm_create_segment` (for example `tagsAny: ["customer"]`). Look at who's in it with `crm_list_contacts_in_segment`.
2. **Pick the channel.** `conv_list_channels`, and use an active email channel. A staff mailbox is a poor sender for large lists: providers cap it at a few thousand messages a day, and bulk mail from it hurts that inbox's reputation. Prefer a channel on a dedicated sending domain or the deployment's managed mailer. If only a personal mailbox is available, say so before going further.
3. **Pick the template.** `outreach_list_email_templates`. Leaving `emailTemplateId` out uses the org default, or a plain built-in layout when the org has none. To build a branded one, follow `skill://outreach/design-email-template` first.
4. **Draft it** with `outreach_create_broadcast`: a `name` the team will recognise ("Changelog — October 2026"), an honest `subject`, a `preheader` that adds to the subject rather than repeating it, and `content`:
   - `format: "markdown"` for a letter-style message;
   - `format: "mjml"` for cards, images and buttons (a fragment of `<mj-section>` elements, see the template skill).

   `{{name|there}}` greets each person by name, falling back to the text after `|`. `{{org_name}}` and `{{subject}}` are also available. There is no other personalisation, and every recipient reads the same words.
5. **Review it with the operator.** Report `audience.eligible` and every non-zero exclusion, the subject and preheader, and the `preview` (`html`, and `text` for clients that don't show HTML). Read `preview.warnings`: above roughly 100KB Gmail clips the message and hides the unsubscribe footer.
6. **Send a test.** `outreach_send_broadcast_test` delivers one copy, subject prefixed with "[Test]", to the signed-in caller or to another member of the organization (`to`). Outsiders are refused. Real inboxes show what the preview can't: dark mode, blocked images, Outlook's layout.
7. **Hand it over for approval.** Tell the operator the broadcast is waiting in the review queue. A change after anyone has looked at it, such as a rewrite with `outreach_update_broadcast`, a template edit, or the audience growing or shrinking, changes `contentFingerprint`, and an approval given for the earlier version is refused. If that happens, show the current version again.
8. **Follow delivery.** After approval a background worker sends at a throttled rate, starting at `scheduledSendAt` or right away. `outreach_get_broadcast` reports `counts`: `queued`, `sent`, `skipped`, `failed`, `replied`, `unsubscribed`, `bounced`. `outreach_list_broadcast_recipients` lists each person with a reason. A recipient whose send failed is retried up to three times before it is marked `failed`.

## Replies

Recipients who don't answer never appear in the inbox. When someone replies, Munin opens a conversation with them. The broadcast they received sits at the top of it, dated when it was sent, so whoever answers sees what they are replying to. Auto-replies and bounces don't count as replies.

## Calling off a broadcast

`outreach_dismiss_broadcast` rejects a pending broadcast for good.

`outreach_cancel_broadcast` calls off an approved one, and what happens depends on whether sending has started:

- **Not started yet** (still in the Scheduled tab): nothing has been sent. The broadcast goes back to `pending` in the review queue with the `reason` attached, its frozen recipient list is dropped, and it can be edited and must be approved again. This is the right move for "wrong date in the copy".
- **Already sending:** it stops. Everyone not yet sent to is marked `skipped` with reason `cancelled`. Emails already delivered cannot be recalled, and the result's `counts.sent` says how many went out. If those people got a mistake, a short correction to the same segment is usually better than silence.

## Don't

- **Don't send to a bought or scraped list.** Lawful basis is recorded per person for a reason. A broadcast to people who never dealt with the organization is spam whatever the tool allows.
- **Don't use a broadcast to dodge the per-contact review of a campaign.** If the message names the recipient's company, deal or situation, it's a campaign.
- **Don't split one announcement into many small broadcasts** to get under a limit. The limits protect the sender's reputation.
- **Don't paste customer replies or CRM fields into broadcast content.** Everything in the content goes to every recipient.
