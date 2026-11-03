---
'@getmunin/backend-core': minor
'@getmunin/db': minor
'@getmunin/types': minor
---

Product events: your own backend can now send events such as `trial.started` or `teammate.invited` to `POST /v1/events`, authenticated with an admin API key that carries only the `analytics:write` scope. Each event names a contact, an external id, an email or a phone number; the event is stored once per event id, linked to the matching end user and CRM contact, and published as `analytics.product_event.recorded` to webhooks.

CRM segments gain behaviour filters: `events` keeps contacts who did, or did not, trigger a named product event, optionally within the last N days and at least a given number of times. The new `analytics_list_product_event_names` tool lists the event names in use.

Also fixed: deleting a segment that an outreach broadcast still uses now returns a conflict instead of a server error, and a contact matched by email from a conversation is now linked to that conversation's end user.
