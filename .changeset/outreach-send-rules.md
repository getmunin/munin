---
'@getmunin/backend-core': patch
'@getmunin/db': patch
'@getmunin/dashboard-pages': patch
---

Org-wide send rules for marketing. A new Sending page under Settings, and `outreach_get_send_rules` / `outreach_configure_send_rules` (plus `GET`/`PUT /v1/outreach/send-rules`), set a default time zone, quiet hours, allowed weekdays, a weekly cap per contact and a pause after a contact last wrote to the team. They are the floor for every marketing send: campaign first touches and follow-ups, broadcasts and journey messages. A journey's settings or a campaign's cadence rules can only make them stricter. A send that would break them is scheduled for the next allowed time in the contact's own time zone. A broadcast recipient in quiet hours or a cool-down is held back and sent later, and one already over the weekly cap is skipped with `frequency_cap`. Transactional messages and replies to a contact's own message are never held back by these rules. Nothing changes until an org sets the rules; the page and `outreach_get_send_rules` offer recommended values (20:00–08:00, 3 a week, 24 hours).

The weekly cap now counts only marketing: transactional journey messages no longer use up a contact's allowance.
