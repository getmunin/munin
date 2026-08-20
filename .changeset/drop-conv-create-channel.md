---
'@getmunin/backend-core': minor
'@getmunin/db': minor
---

Remove `conv_create_channel`. It took `config` as a free-form object and persisted it verbatim, with no per-type validation, no encryption and no credential slots — so an email channel created through it read as complete in `conv_list_channels` and was unusable: the stored config failed the schema every later read applied, the credential link could not describe its password fields, and the dashboard had nowhere to save them. A plaintext `password` passed in that config was stored unencrypted and echoed back, since config masking only covers `encrypted*` keys.

Both remaining types already have a tool that provisions them properly, and the type this tool made easiest to reach was the one it broke: `conv_configure_email_channel` validates the transport config, encrypts secrets and returns a credential link; `conv_create_widget_channel` mints the widget key a chat channel cannot work without. Voice and SMS were removed from this tool for the same reason in 4.76.0; nothing remained that it could create correctly. Use those tools instead, or `conv_import` when moving historical channel rows between servers.

Migration `0073_conv_email_channel_credential_slots` repairs email channels already written that way: it adds the missing `encryptedPassword` slots, deactivates the channel so an existing credential link can complete it, and drops any plaintext `password` key.
