---
title: "Outreach: Draft a first-touch WhatsApp message"
description: Draft first-touch outreach for a campaign running on a WhatsApp channel. A WhatsApp first touch is always an approved message template with its placeholders filled; one pending proposal per (campaign, contact), and only a signed-in person in the Munin dashboard can approve it.
audiences: [admin]
---

# Draft a first-touch WhatsApp message

Same shape as `skill://outreach/draft-first-touch-sms`, with one difference that changes the whole job: **you don't write the text.** WhatsApp only delivers a business-initiated message if it is a message template Meta has approved, so a WhatsApp first touch is a choice of template plus the values for its placeholders. Munin renders the result into the draft the operator reviews.

**Approving is a dashboard-only action**, exactly as for SMS and calls. File the proposal, tell the operator it is waiting in the dashboard inbox, and stop.

## The pass

1. **List campaigns** with `outreach_list_campaigns` and keep the enabled ones whose channel is WhatsApp (`conv_list_channels` shows `type: "whatsapp"`).
2. **List the templates** with `conv_list_whatsapp_templates { channelId, status: "approved" }`. Pick one whose purpose matches the campaign brief. Outreach is almost always `marketing`; a `utility` template is only right when the message is about something the contact already has with the business (an order, a booking, a renewal). If nothing fits, stop and tell the operator which template they need to create in Meta Business Manager — don't bend an unrelated one.
3. **Materialise the audience** with `crm_list_contacts_in_segment(campaign.segmentId)`. It is already filtered for suppression and lawful basis. Anyone who replied `STOP` or pressed *Stop promotions* is suppressed and will not appear.
4. **Skip contacts with no `phone`**, and prefer contacts whose `consentSource` shows they agreed to hear from the business on WhatsApp — WhatsApp's policy requires opt-in, and a number with too many "block" or "report spam" reactions gets its messaging limits cut.
5. **Dedupe** via `outreach_list_proposals({ kind: "initial", campaignId, contactId })`.
6. **File** with `outreach_propose_first_touch`:

```jsonc
{
  "name": "outreach_propose_first_touch",
  "arguments": {
    "campaignId": "ocmp_…",
    "contactId": "cct_…",
    "whatsappTemplate": {
      "templateName": "spring_offer",
      "language": "nb",
      "variables": { "1": "Kari", "2": "20 %" }
    },
    "evidence": { "why": "Bought the starter kit in March; opted in at checkout" }
  }
}
```

No `draftBody` and no `draftSubject` — the template is the body. The call fails up front if the template is not approved, the language doesn't exist, or a placeholder is missing or unknown.

7. **Stop.**

## Filling placeholders

- **Personalise only what the template leaves open.** The template text is fixed; the placeholders are yours. Use the contact's first name, not their full name, where the template greets.
- **Match the template language to the contact.** The same template usually exists in several languages; choose the contact's.
- **Keep values short and plain.** A placeholder value can't contain newlines or markdown, and a long value makes a template read like spam.

## Revising

The rendered text can't be edited — Meta approved the template, not a freehand variant — so `outreach_update_proposal` with a new `draftBody` is refused on a WhatsApp proposal. To change the template or its values, withdraw the proposal (`outreach_withdraw_proposal`) and propose again.

## What happens on approval

A person approves in the dashboard. Munin re-checks the template is still approved, re-checks the contact's consent, starts (or reuses) a conversation on the campaign's WhatsApp channel in `draft_only` mode, and sends the template. When the contact replies, the 24-hour customer-service window opens and replies are free text again — `outreach_propose_reply` works on that conversation. Follow-up sequences are email-only.
