---
'@getmunin/backend-core': patch
'@getmunin/db': patch
---

Journeys and outreach no longer step on each other. `journeys_create` and `journeys_instantiate_template` now take the email channel to send from (`senderChannelId`) instead of an outreach campaign: the journey creates its own campaign, without a segment and with outreach's own drafting turned off, and campaigns report the journey that sends through them as `journeyId`. While a journey exists, `outreach_update_campaign` only accepts a new name, extraction fields or another email channel (and the channel only while the journey is not live); anything else is refused with `outreach_journey_managed` instead of silently changing or breaking a running journey. Archiving a journey releases its campaign, so a converted campaign can be run by a new journey.

Replies on a journey's threads belong to the journey. Outreach no longer auto-drafts a reply there, so a contact who answers a journey email can't end up with two replies in review. `outreach_propose_reply` is refused while the journey run is following the reply. When the step has no `onReply` path, the run waits as before and the conversation is now flagged for the team in Conversations.
