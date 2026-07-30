---
'@getmunin/backend-core': minor
---

SMS outreach campaigns

An outreach campaign can now run on an SMS channel. `outreach_propose_initial` drafts a text against a contact's phone number, and a person approving it in the dashboard creates the outbound conversation and sends the message. As with voice, an agent cannot approve one.

Drafts are capped at 480 characters — roughly three billable segments — and rejected above it, with the limit stated in the tool schema so a curator can write to it rather than discover it. Composition is SMS-shaped: the campaign CTA is appended as a bare URL and the opt-out line as `Reply STOP to opt out.`, instead of the markdown link footer an email gets. `skill://outreach/draft-initial-sms` covers the writing rules, including why an emoji triples the cost of a message.

**Outbound SMS was never actually delivered.** `ConvService` enqueued a `conv_message_deliveries` row only for `channelType === 'email'`, so an agent or operator replying on an SMS conversation stored a message that silently never sent — the `OutboundDeliveryWorker` and both SMS adapters were fine, nothing was ever handed to them. The gate now covers email and SMS.

Follow-up sequences stay email-only: an SMS campaign rejects `sequenceSteps`, and `outreach_propose_followup` still refuses a text conversation. One touch, then the reply flow, which works because inbound texts thread into the outreach conversation.

`findOrCreateContactByPhone` was duplicated in the Vapi and Threll adapters and inlined a third time in the outreach voice path; it is now one shared helper taking the source as a parameter.
