---
title: Set the send rules
description: Set the org-wide rules every marketing send follows — the default time zone, quiet hours, weekdays, a weekly cap per contact and a pause after a contact last wrote to the team. Campaigns, broadcasts and journeys all respect them, and a journey or campaign can only be stricter.
audiences: [admin]
---

# Set the send rules

The send rules are the org's floor for marketing. They decide *when* a message may reach a contact, not *whether* it is allowed at all: unsubscribe, do-not-contact, lawful basis and undeliverable addresses are always enforced on top, with or without rules.

## Read what is set

```jsonc
{ "name": "outreach_get_send_rules", "arguments": {} }
```

`configured: false` means the org never set them, and none apply: marketing goes out as soon as it is approved or due, at any hour. `recommended` holds sensible values (20:00–08:00 quiet hours, at most 3 marketing messages per contact a week, a 24-hour pause after a conversation).

## Set them

Ask the operator for their market's time zone and how often they are comfortable writing to the same person, then pass the whole set:

```jsonc
{
  "name": "outreach_configure_send_rules",
  "arguments": {
    "timezone": "Europe/Oslo",
    "quietHours": "20:00-08:00",
    "validDays": null,
    "weeklyCap": 3,
    "cooldownHoursAfterConversation": 24
  }
}
```

- `timezone` is the fallback for contacts without their own `customFields.timezone`. A journey's `settings.timezone` comes before it for that journey.
- `quietHours` and `validDays` hold marketing until the next allowed time in the contact's time zone. `null` turns each off.
- `weeklyCap` counts every marketing message a contact received in the last 7 days: campaign first touches and follow-ups, broadcasts and marketing journey messages. Transactional journey messages are not counted.
- `cooldownHoursAfterConversation` waits after the contact last wrote to the team. Marketing also waits while a teammate is assigned to one of their open conversations, whatever this says.

## What it does to each kind of send

- **Campaign first touches and follow-ups:** approving one during quiet hours, over the cap or right after a conversation schedules it for the next allowed time instead of sending it now. The approval result says `approved` with `scheduledSendAt`; say which time to the operator.
- **Broadcasts:** a recipient in quiet hours or in a cool-down is held back and sent later; a recipient already over the weekly cap is skipped with `skipReason: "frequency_cap"`. The broadcast stays `sending` until the held recipients have gone out.
- **Journeys:** every message step waits for the next allowed time. A journey's own `settings` can only add to the rules — another quiet window, fewer weekdays, a lower cap, a longer pause — never loosen them.
- **Never held back:** transactional messages (a journey step with `class: "transactional"`, such as a booking confirmation) ignore the org rules, though a journey's own quiet hours still apply to them. Replies to something the contact wrote ignore the rules entirely.
