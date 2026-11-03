---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': patch
'@getmunin/db': patch
'@getmunin/types': minor
---

Journeys no longer need an outreach campaign to send through.

- `journeys_create` with `senderChannelId` stores the journey's own email channel (`senderChannelId` on the journey) instead of creating a hidden campaign, and `journeys_update_sender` changes it, moving open emails along. A journey converted from a campaign keeps that link, and the campaign still stops proposing while the journey runs.
- Journey proposals carry `journeyId` and no `campaignId`, and send from the journey's channel. The review inbox, decided feed and Slack approvals name the journey (`journey` on the proposal DTO).
- Unsubscribe links in journey emails name the journey; `crm.contact.unsubscribed` carries `journeyId`, and the unsubscribe guardrail counts it against that journey. A stop decision is counted the same way.
- Call outcomes from journey calls are extracted without a campaign.
- A reply the journey hands to the team is answered in Conversations; outreach reply proposals stay for campaign threads.
- Migration `0143_journey_proposals_without_campaign` adds `journeys.sender_channel_id` (filled from each journey's campaign) and `outreach_proposals.journey_id` (filled for existing journey proposals). It makes both campaign references nullable and adds a check that a proposal belongs to a campaign or, for journeys, to a journey. Proposals filed before this keep their campaign.
