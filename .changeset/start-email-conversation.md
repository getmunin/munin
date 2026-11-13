---
'@getmunin/backend-core': minor
---

Start a new email conversation with just an address. `conv_start_email_conversation` (and `POST /v1/conversations/email`) opens a fresh thread from one of the org's email channels, reusing the contact for that address or creating one. Before, the only way to email someone first was an outreach campaign.

Who calls it decides whether mail goes out. When a signed-in person calls it, the message is sent right away (`delivery: "queued"`). When an agent calls it, the message is stored as a draft on the new conversation and sent only once a person approves it in the inbox (`delivery: "awaiting_approval"`). This holds even on channels set to `auto`: that mode lets an agent answer people who wrote in, not write to any address it chooses. An address whose CRM contact is marked do-not-contact, or whose mail is known to bounce, is refused. When the org has more than one active email channel, `channelId` is required. The route is limited to owners, admins and admin keys with `conv:write`.

`ConvService.createConversation` takes a new `firstMessageAsDraft` flag. It stores the opening message as a `draft_reply` instead of queuing delivery. The new `skill://conv/start-email-conversation` describes how agents should use the tool.
