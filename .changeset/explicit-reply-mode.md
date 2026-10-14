---
'@getmunin/backend-core': minor
'@getmunin/db': minor
'@getmunin/types': minor
'@getmunin/dashboard-pages': minor
---

Whether Munin answers customers on its own is now a choice the organization makes when it sets up a channel, not something a default decides for it.

Every channel that receives messages now needs a reply mode when it is created. That means a chat widget, an SMS number, and an email channel with inbound. The modes are `auto` (the agent answers directly), `draft_only` (the agent drafts each reply for a teammate to approve and send) and `off`. There is no default. `conv_create_widget_channel` requires `defaultAgentMode`. `conv_configure_email_channel` requires it on a create with `config.inbound`, and on the update that adds inbound to an outbound-only channel. `conv_configure_voice_sms_channel` requires it when it creates an SMS channel. Leaving it out is refused with `conv_agent_mode_required`. The dashboard's create dialogs start with no mode selected and won't save until one is picked.

Chat widgets now have a reply mode at all. Before this change, widget conversations always opened in `auto`, whatever the channel row said. `conv_update_widget_channel` and the widget's edit dialog can now change the mode, and new widget conversations open in it. Existing widget channels keep `auto`.

New conversation topics no longer force drafts. Topics created by the tagging pass used to start in `draft_only`, which silently overrode a channel set to `auto` as soon as a conversation was tagged. New topics now inherit their channel's mode. A topic override is an exception an operator sets on purpose, for example to keep complaints or privacy requests in review. Existing topics keep whatever mode they already have; nothing is backfilled.
