---
'@getmunin/backend-core': minor
---

Inbound SMS threads into the existing conversation, and STOP unsubscribes

Webhook-mode channels used to open a brand-new conversation for every inbound message. Two texts from the same person were two unrelated conversations, and no reply could ever be attributed to what it was replying to. Inbound messages now land in that contact's most recent open conversation on the channel, reopening it if it was snoozed; a closed conversation still starts a fresh one. New conversations also inherit the channel's `defaultAgentMode`, which the generic ingest path was dropping while the email path honoured it.

An inbound SMS whose entire body is an opt-out keyword — `STOP`, `STOPP`, `SLUTT`, `AVMELD`, `UNSUBSCRIBE`, `END`, `QUIT`, `CANCEL`, `STOPALL`, case-insensitive, trailing punctuation ignored — now suppresses the CRM contact holding that number: `doNotContact` set, `unsubscribedAt` stamped, and a `crm_activities` note recording why. The message is still ingested so the conversation reads truthfully, and suppressed contacts drop out of `crm_list_contacts_in_segment`, so they leave every outreach audience. A message that merely contains the word ("can you cancel my order?") is an ordinary message.

Honouring STOP is a legal requirement for SMS in the US and expected practice in the EU, so this lands before SMS outreach rather than alongside it.
