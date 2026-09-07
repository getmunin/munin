---
'@getmunin/backend-core': patch
---

Record an internal note when tagging a conversation changes how it gets answered.

A topic's automation override beats the conversation's own mode, so classification can
silently flip a conversation from auto-sending to draft-only mid-thread — the topic
classifier runs a few seconds after the first message lands, which is late enough that
one or two replies may already have gone out automatically. Nothing in the thread
recorded the switch, so the composer simply stopped producing messages and the only
evidence was a draft that stays invisible until someone claims the conversation.

`conv_set_topic` now compares the effective agent mode either side of the write and, when
it differs, appends an internal note — `authorType: 'system'`, `authorId:
'topic-automation'`, `metadata.kind: 'automation_mode_changed'` carrying `from` and `to`.
It lands chronologically between the last auto-sent reply and the first draft, which is
where someone hunting for the missing message actually looks.

Two deliberate limits. The note fires on a *change*, not on the state: one on every
draft-only conversation would be furniture within a week, while the transition is the
thing no present-tense status chip can express. And it is internal, so
`toRuntimeHistory` strips it before the model sees it — the agent cannot start deferring
to review policy or mentioning it to a customer.

Not addressed here: the replies that auto-send during the window before classification
finishes still escape a `draft_only` topic. The note documents that leak rather than
closing it.
