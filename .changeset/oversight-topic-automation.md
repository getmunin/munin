---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
'@getmunin/db': minor
'@getmunin/types': minor
---

Reply automation becomes a per-topic decision. A topic starts with no policy and its drafts
go to review; once its record holds — enough drafts reviewed, few edited, almost none
rejected — an operator can promote it and replies on that topic send without review.
Demotion is one call.

`/dashboard/automation` shows the record per topic, what is blocking a promotion, and the
promote dialog with the three rates behind the decision. `conv_list_topic_automation` and
`conv_set_topic_automation` expose the same surface to agents, documented by
`skill://conv/promote-topic-to-auto-send`.

Two things worth knowing about how this stays safe:

A conversation whose agent mode an operator set deliberately keeps that mode. The new
`conv_conversations.agent_mode_source` column records whether a mode was inherited from the
channel default or chosen, and only inherited ones are governed by a topic policy — so
promoting a topic can never re-enable an agent somebody turned off for one conversation.

Rejecting a draft now stamps it `draft_reply_rejected` instead of deleting the row. Deleting
it threw away the one signal that should block a promotion, and the rejection rate is the
number an operator most needs before automating a topic. Rejected drafts stay internal and
are filtered out of the conversation thread exactly as sent and superseded drafts are.
