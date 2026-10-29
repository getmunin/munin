---
'@getmunin/agent-runtime': patch
---

Close or snooze a conversation from the audit pass only once the reply has actually been sent.

The audit ran its `close_conversation` / `snooze_conversation` actions before the reply went out. When the same turn assigned a topic whose automation is still draft-only, the send was refused and the reply was parked for review — but the conversation had already been closed, leaving a pending draft and a handover inside a resolved thread with no reply to the customer. Those two actions are now held until the send succeeds and dropped when the reply ends up parked, the same way a turn that starts in draft-only mode already withholds them.
