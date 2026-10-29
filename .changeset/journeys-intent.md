---
'@getmunin/backend-core': minor
'@getmunin/types': minor
---

Journeys can act on what a reply means. Point an email's `onReply` at an agent decide step reading the reply, and its chosen edge (for example interested, question, not now, stop) decides what the journey does next while Conversations answers the person. An agent edge named `stop` also ends every other journey the person is in, with the exit reason `conversation_stop`.

Setting a topic on a conversation now emits `conversation.topic_set` (with the topic id and slug), so a topic such as a pricing question can enter the person into a journey through an event trigger.
