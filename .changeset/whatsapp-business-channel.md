---
'@getmunin/backend-core': minor
'@getmunin/db': minor
'@getmunin/types': minor
'@getmunin/core': minor
'@getmunin/agent-runtime': minor
'@getmunin/agent-host': minor
'@getmunin/dashboard-pages': minor
'@getmunin/inspector-app': minor
---

Add WhatsApp Business as a conversation channel, talking to Meta's WhatsApp Cloud API directly.

**Setup.** WhatsApp is a new channel kind (`whatsapp`, vendor `meta`) configured through the
existing voice/SMS tools: `conv_configure_voice_sms_channel { vendor: "meta", config: { wabaId,
phoneNumberId } }` creates it pending, and the credential link collects the system-user access
token and the app secret. Saving verifies the token, subscribes the app to the WhatsApp Business
Account, and registers Munin's webhook on that phone number with Meta's per-number override, so
several numbers on one Meta app can each belong to their own channel. The webhook's GET
verification challenge is answered from a token derived from the channel id, which is why it
works even while the channel row is still being created.

**Inbound.** Signed (`X-Hub-Signature-256`) webhook deliveries become messages threaded on the
sender's E.164 number, so a WhatsApp contact merges with the same person's SMS and CRM phone.
Text, interactive and template-button replies arrive as text; images are stored as attachments;
documents, video, locations and stickers become a short description. Delivery statuses update
the delivery, reactions are recorded on the message they react to, and `STOP` or a marketing
template's *Stop promotions* button suppresses the contact like an SMS opt-out. The channel
adapter contract gained an optional `challenge` hook and an inbound `media` slot for this; Twilio
MMS benefits from the latter.

**The 24-hour window.** Free text reaches a WhatsApp contact only within 24 hours of their last
message. `conv_get_conversation` reports `whatsappWindow`, `conv_send_message` refuses free text
on a closed window with `conv_whatsapp_window_closed` before anything is queued, and Meta's
re-engagement error (131047) ends a delivery as `dead` instead of retrying. The agent does not
answer a conversation whose window has closed.

**Templates.** `conv_list_whatsapp_templates` reads the account's templates live from Meta and
`conv_send_whatsapp_template` sends an approved one — into an existing conversation, or to a CRM
contact with a recorded lawful basis, reusing their open conversation. Templates are never stored
in Munin; the rendered text is kept on the thread with the template recorded in message metadata.
Outreach campaigns can run on WhatsApp: a first touch is a template chosen in
`outreach_propose_first_touch` (new `whatsappTemplate` input, `draftBody` now optional), stored in
the new `outreach_proposals.whatsapp_template` column, and approved in the dashboard like SMS and
calls.

**Read receipts** are recorded the way email opens are — `first_opened_at` on the delivery and a
`conversation.message.opened` webhook. `conv_get_email_open_stats` is renamed
`conv_get_open_stats` and reports email and WhatsApp channels together.

**Voice notes** are stored as audio attachments and transcribed by a new
`task://conv/transcribe-voice-note` job using a transcription model chosen in the AI settings
(`agent_config.transcription_model`, added by the agent-host DDL). It uses the same provider and
key as the chat models: with the built-in provider it defaults to the first model the deployment
offers through the new `defaultTranscriptionModels` module option, and with an org's own key the
choice comes from the speech-to-text models in that provider's model list. The agent waits for
the transcript; a voice note that can't be transcribed goes to a human. A finished transcript
emits `conversation.message.transcribed`, which also updates Slack mirrors.

The dashboard gets WhatsApp channel setup, the window and a template picker in the composer, an
audio player with the transcript on voice notes, read indicators, and a transcription-model
setting. New skills: `skill://conv/send-whatsapp-template` and
`skill://outreach/draft-first-touch-whatsapp`; the voice/SMS setup, delivery recovery, open
tracking and proposal review skills cover WhatsApp.
