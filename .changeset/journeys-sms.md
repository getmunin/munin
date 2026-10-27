---
'@getmunin/backend-core': minor
'@getmunin/db': minor
'@getmunin/types': minor
'@getmunin/dashboard-pages': minor
---

Journey SMS steps: a `message` node can use `channel: "sms"` and send from `settings.smsChannelId`, so one journey mixes email and text messages. SMS steps carry only a body (480 characters, `{{name|fallback}}`), never send automatically and are approved by a signed-in person; replies on the SMS thread follow the step's `onReply`. Outreach proposals gain an optional `channel_id` that overrides the campaign's channel, and the review inbox shows them as SMS. A reply now resumes from the step whose message landed in the replied thread.
