---
'@getmunin/backend-core': patch
'@getmunin/types': patch
'@getmunin/db': patch
---

fix(slack): mirrored replies lose their signature when the strip lands late

An inbound email is mirrored into Slack the moment it is ingested, but the
signature stripper is a curator job that runs afterwards — so the dashboard
showed the cleaned one-liner while the Slack thread kept the full sign-off and
contact block. `conv_strip_message_signature` now emits
`conversation.message.body_revised`, and the Slack bridge edits the reply it
already posted (`chat.update`) instead of leaving the stale copy in place.

`slack_message_links.author_labeled` records whether the mirror had to embed the
speaker's name in the message text (the `chat:write.customize` fallback), so the
edit reproduces the same shape rather than silently dropping the author line.
