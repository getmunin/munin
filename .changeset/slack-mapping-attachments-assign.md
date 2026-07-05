---
'@getmunin/backend-core': minor
---

Slack integration phase 4: manual user links, attachment handling, !assign

- New admin tools `slack_list_user_links`, `slack_link_user`, `slack_unlink_user` for managing Slack-user ↔ Munin-member attribution when the profile-email auto-match does not apply. Linking again replaces the mapping; unlinked users fall back to rejection.
- Attachment links on mirrored Munin messages render as :paperclip: lines in the thread (best-effort over the loosely-typed `conv_messages.attachments`). Inbound Slack files are refused loudly instead of dropped silently: a file-only reply is rejected with an ephemeral notice, and a reply with files goes out as text with a warning that the files were not forwarded.
- `!assign me` / `!assign @teammate` in a mirrored thread assigns the conversation through `conv_assign_conversation` as the sender; unmapped mentionees get an ephemeral error. The assignment mirrors back into the thread and parent status line like any other event.
