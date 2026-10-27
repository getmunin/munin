---
'@getmunin/backend-core': minor
'@getmunin/db': minor
'@getmunin/dashboard-pages': minor
'@getmunin/inspector-app': minor
---

Journeys can now send email. A message step renders its subject and markdown or MJML body in the org's email template and files it as an outreach proposal of kind `journey`, so it appears in the review inbox labelled as a journey email. The run waits there: approval sends it and the journey continues; a dismissal ends that person's run; a withdrawal skips the step. Steps the publisher set to `auto` send without review and do not post a Slack approval card. The first email opens a conversation and later steps reply in the same thread, as HTML with a working unsubscribe link and List-Unsubscribe header.

Every journey email passes the send rules at drafting, at approval and again at send time. Marketing email never goes to unsubscribed, do-not-contact or undeliverable addresses or to contacts without a recorded lawful basis; transactional email reaches unsubscribed contacts but never do-not-contact ones. Quiet hours and valid days follow the contact's time zone, a weekly cap counts journey, campaign and broadcast emails together, and marketing email waits while the contact is talking to the team and for a cool-down after their last message. When a contact replies, the run follows the step's `onReply` path, or holds until the conversation closes.

A campaign run by a journey no longer accepts hand-filed first touches or follow-ups, its legacy follow-up sweep skips it, and journey proposals are left out of outreach exports.
