---
'@getmunin/backend-core': patch
---

fix(slack): stop the bridge spamming a channel when its mirrored thread was deleted

Deleting a mirrored conversation thread in Slack turned the next conversation update into a channel-level repost loop. `chat.postMessage` does not reject an unknown `thread_ts` — it drops the reply into the channel root — so the thread reply (e.g. ":white_check_mark: *Conversation is resolved.*") posted as a normal message, and the parent `chat.update` that ran afterwards failed with `message_not_found`, which is a retryable error: five attempts per delivery, each one reposting the reply.

The parent is now synced before any thread reply, and a `message_not_found` there retires the conversation link and finishes the delivery terminally instead of retrying. Nothing is reposted into the channel, and the next event for that conversation starts a fresh thread parent through the normal lazy-link path. A revise of a mirrored message whose Slack message was deleted likewise finishes instead of retrying five times.

Deletions also arrive as Slack `message_deleted` events on the `message.channels` subscription the app already holds, so the thread and message links are dropped as the operator deletes — no manifest change, no re-install. That closes the same hole on the message-mirroring path, where a reply into a deleted thread would otherwise keep landing in the channel with nothing to detect it.
