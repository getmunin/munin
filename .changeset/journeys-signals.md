---
'@getmunin/backend-core': minor
'@getmunin/types': minor
'@getmunin/agent-host': minor
'@getmunin/dashboard-pages': minor
---

New events for journeys and webhooks: `crm.contact.unsubscribed` when a contact follows an outreach or broadcast unsubscribe link, `conversation.message.bounced` when a hard bounce notice arrives, and `outreach.outcome.recorded` when outcome extraction writes `outreachOutcome` to a contact. System alerts gain a `journeys` source. Journey validation now warns about agent steps when the org has no LLM provider configured: agent-host provides an `LLM_AVAILABILITY` port that backend-core reads without depending on agent-host, and `AgentHostModule` is now global so the port reaches feature modules.
