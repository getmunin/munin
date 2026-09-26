---
title: Send a WhatsApp template
description: Reach a WhatsApp contact outside the 24-hour customer-service window — or start a conversation with them — by sending an approved message template with its placeholders filled.
audiences: [admin]
---

# Send a WhatsApp template

WhatsApp lets a business send free text only while the customer-service window is open: **24 hours from the customer's last message**. Outside that window — and whenever the business speaks first — the only thing WhatsApp delivers is an **approved message template**. Use this skill for follow-ups after a quiet day ("we've replied to your case", "your order shipped"), for a reply a human approved too late, and for messaging a contact who has never written in.

## Is the window open?

`conv_get_conversation` returns `whatsappWindow` on every WhatsApp conversation:

```jsonc
{ "open": false, "closesAt": "2026-09-24T10:02:11.000Z", "lastInboundAt": "2026-09-23T10:02:11.000Z" }
```

- `open: true` → send normally with `conv_send_message`. A template is allowed too, but free text reads better.
- `open: false` → `conv_send_message` answers `conv_whatsapp_window_closed`. Send a template.
- `lastInboundAt: null` → the contact has never written on this channel; the window has never been open.

The window re-opens the moment the customer replies, so one template that invites a reply is usually all you need before normal conversation resumes.

## Pick a template

```jsonc
{ "name": "conv_list_whatsapp_templates", "arguments": { "channelId": "cch_…", "status": "approved" } }
```

Templates are read live from the channel's WhatsApp Business Account — Munin does not store them, and nobody creates or edits them here; that happens in Meta Business Manager and goes through Meta's review. Each one carries:

- `name` and `language` — both must be passed back exactly. The same name usually exists in several languages; pick the customer's.
- `category` — `utility` (about something the customer already has going: an order, a booking, a case), `marketing` (promotion, re-engagement), or `authentication` (one-time codes). **Prefer `utility` for service follow-ups.** Marketing templates cost more, need marketing consent, and can be muted by the customer.
- `bodyText` / `headerText` / `footerText` with placeholders like `{{1}}` or `{{first_name}}`, and `variables` / `headerVariables` listing the placeholder names you must fill.
- `status` — only `approved` templates can be sent.

If no template fits, say so and suggest the operator creates one in Meta Business Manager. Don't bend an unrelated template to carry a message it wasn't approved for — that is the fastest way to get the number's quality rating downgraded.

## Send it

To continue an existing conversation:

```jsonc
{
  "name": "conv_send_whatsapp_template",
  "arguments": {
    "conversationId": "ccv_…",
    "templateName": "case_update",
    "language": "nb",
    "variables": { "1": "Kari", "2": "A-1042" }
  }
}
```

To message a CRM contact (their open conversation on the channel is reused; otherwise a new one starts):

```jsonc
{
  "name": "conv_send_whatsapp_template",
  "arguments": {
    "contactId": "cct_…",
    "channelId": "cch_…",
    "templateName": "order_update",
    "language": "en_US",
    "variables": { "first_name": "Ola", "order": "A-1042" }
  }
}
```

Every placeholder listed in `variables` / `headerVariables` must be filled, and nothing else — the tool names the missing or unknown ones. The rendered text is stored on the thread as the message body, with `metadata.whatsappTemplate` recording the template, so the conversation reads naturally afterwards. Delivery then works like any outbound message: `deliveryStatus`, and `firstOpenedAt` once the customer reads it.

## Consent

- A contact who opted out (`doNotContact`, `unsubscribedAt`, or who replied `STOP` / pressed *Stop promotions*) is refused with `conv_conflict` — on both paths.
- Starting from `contactId` also requires a recorded lawful basis on the CRM contact. WhatsApp's own policy expects **explicit opt-in to hear from the business on WhatsApp**; record where it came from in `consentSource` (for example `checkout-whatsapp-opt-in`) when you set consent, and never invent consent to get a send through.

## What NOT to do

- **Don't retry free text on a closed window.** It fails before anything is queued; a template is the only way through.
- **Don't send a template on every turn.** Once the customer replies, the window is open again — go back to `conv_send_message`.
- **Don't guess placeholder names.** Read them from `conv_list_whatsapp_templates`.

## Related

- `skill://conv/setup-voice-sms-channel` — connecting the WhatsApp number.
- `skill://conv/recover-failed-deliveries` — a reply that died because the window closed before it went out.
- `skill://outreach/draft-first-touch-whatsapp` — templates as outreach first touches.
