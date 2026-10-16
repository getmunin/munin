---
"@getmunin/backend-core": minor
"@getmunin/db": minor
---

Keep chat-widget conversations that no one wrote in out of the inbox and out of Slack. Opening the widget starts a conversation and the agent greets straight away, so every visitor who closed the panel without asking anything used to leave an open conversation in the inbox, a Slack thread, and a "resolved" reply in that thread when auto-close reached it two days later.

A new `conv_conversations.unengaged` flag marks a conversation the widget opened. It clears on the first visitor message, when a voice call starts in the widget, or when a teammate writes in the conversation. While it is set:

- the conversation is left out of `conv_list_conversations`, the inbox queue and its counts, the usage tile, the first-run setup state and the identity profile's conversation count;
- the Slack bridge records its deliveries but holds them back. They are released when the flag clears, so the thread then appears with the full history, greeting included, in the original order;
- auto-close skips it.

A new hourly sweep deletes unengaged conversations after 24 hours without activity. It skips any conversation that still has attachment rows; the attachment GC removes those uploads first, and a later sweep deletes the conversation. A visitor who comes back to a swept session gets a new conversation when they write. Configure it with `MUNIN_CONV_UNENGAGED_CLEANUP_CRON` (`off` disables it) and `MUNIN_CONV_UNENGAGED_IDLE_HOURS`. The sweep shares `MUNIN_CONV_AUTO_CLOSE_DISABLED` with auto-close.

Migration `0120_conv_unengaged_conversations` adds the column and a partial index. It also flags existing widget-opened conversations that hold no visitor or teammate message, so the first sweep clears the backlog. Slack threads already posted for those conversations stay in Slack.
