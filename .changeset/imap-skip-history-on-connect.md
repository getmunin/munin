---
"@getmunin/backend-core": patch
"@getmunin/types": patch
---

Connecting an IMAP mailbox no longer imports its entire history. Previously the first poll read from UID 1 and paged through every message ever received, 100 per minute, opening each as a fresh conversation and dispatching the agent on it. The first poll now starts from the first message the server received after the channel was activated (with ten minutes of slack for clock skew), and imports from there in the same poll — so a test email sent straight after saving the credentials shows up on the first poll, while older mail stays put.

Operators who want recent threads in the inbox can set `inbound.backfillDays` (1–90) on `conv_configure_email_channel`; the first poll then starts from the earliest message received in that window. It applies only to that first poll.

The IMAP cursor now also records the mailbox's `UIDVALIDITY`. When the server renumbers a mailbox, the poller restarts from its current end instead of skipping new mail or re-importing old mail under the new numbering. Existing channels adopt the server's value on their next poll and carry on from their stored position.

