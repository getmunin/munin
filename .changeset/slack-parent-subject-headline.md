---
'@getmunin/backend-core': minor
'@getmunin/types': minor
---

Slack thread parents now headline the conversation subject once it is set. `conv_set_subject` emits a new `conversation.subject_changed` event, the Slack bridge mirrors it by refreshing the thread root in place (no thread reply), and the parent headline switches from "New conversation #N" to the subject.

Resolved conversations are now unmistakable in Slack: the parent's status line becomes a ":white_check_mark: *Conversation is resolved.*" banner (":no_entry_sign: *Marked as spam.*" for spam), and status-change thread replies use human phrasing ("Conversation is resolved.", "Conversation reopened", "Conversation snoozed") instead of "Status changed to *closed*".
