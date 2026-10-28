---
'@getmunin/backend-core': patch
'@getmunin/db': patch
---

Journey messages now go out through their own journey outbox instead of special cases spread through the outreach service.

- `JourneyOutboxService` drafts journey messages, checks that the run is still live and the pinned email template is unchanged, applies the journey's send policy, and delivers by email, SMS, chat or call. It registers itself as the handler for `journey` proposals, so the outreach approve, schedule and send lifecycle no longer branches on journeys, and outreach never imports the journeys module (a test guards this).
- The consent, suppression and deliverability check that six send paths repeated is now one `assertEligible` (marketing needs consent and no unsubscribe; transactional only respects do-not-contact; email also refuses addresses known to bounce).
- A journey proposal's delivery settings (channel, format, template pin, send policy, auto-approval) move from the reviewer-facing `evidence` into a new `journey_delivery` column, validated on every send. A proposal whose settings can't be read is refused with `outreach_journey_invalid` instead of falling back to defaults, and a database check keeps the column set on journey proposals only. Proposals now also return `journeyEnrollmentId`, `journeyStepRunId` and `journeyDelivery`.
- Migration `0140_proposal_journey_delivery` adds the column, copies existing settings out of `evidence` (filling the previous defaults where they were missing) and adds the check.
