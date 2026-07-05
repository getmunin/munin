---
'@getmunin/backend-core': patch
---

Fix chat-widget read-state loss on identity claim: when an anonymous session is claimed by a verified visitor (`identify`), the anonymous end-user's `conv_message_reads` rows are now migrated to the verified end-user before the anonymous end-user is deleted. Previously the read receipts were cascade-deleted with the anonymous end-user, so already-read agent replies resurfaced as unread (phantom unread badge) after logging in.
