---
"@getmunin/backend-core": minor
"@getmunin/types": minor
"@getmunin/dashboard-pages": minor
---

Choose which voice channel answers a chat widget's calls. `conv_create_widget_channel` and `conv_update_widget_channel` take a `voiceChannelId`, as do `POST` and `PATCH /v1/conversations/channels/widget`. Pass `null` on update to unlink. Only a Vapi or Threll voice channel in the same organization can be linked; anything else is refused with `conv_widget_voice_channel_invalid` before it is saved. Until now the link could only be set in the database, so an organization with two voice channels had no supported way to make widget calls work.

Updating a widget channel no longer erases its voice link. The update rebuilt the stored config from a fixed list of fields, so any edit, even one that only changed the origin allow-list, silently removed `voiceChannelId`, and calls fell back to `multiple_voice_channels_without_widget_routing`. It now carries every stored field forward.

Chat widget cards in the dashboard gain an Edit dialog for the origin allow-list and the voice channel, and the create dialog offers the same voice channel picker. Edit takes the card's main button, matching the other channel cards, and the embed snippet sits beside it as a plain text button. Each card says where its calls go, and is flagged when they are off: several voice channels with none linked, a linked channel that has been deleted, or one that is deactivated.
