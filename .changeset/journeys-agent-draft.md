---
'@getmunin/backend-core': minor
'@getmunin/types': minor
'@getmunin/dashboard-pages': minor
---

Journey emails can be written by an agent for each person. A message step with `draftBy: "agent"`, a `brief` and the knowledge-base spaces to ground it in files a curator job (`skill://journeys/draft-step`) that rewrites the author's reference email from the facts the step may see, cites the documents its claims rest on, and submits it with `journeys_submit_draft`. The draft always goes to the review inbox with its sources; if the agent does not answer in time, the reference version is filed instead. Agent-drafted steps cannot be set to send without review yet.

Agent steps gain an `enrich` mode: the agent fills declared fields (string, number, boolean, date or enum) through `journeys_submit_fields`, written to the contact's custom fields and to the journey context so later branches can route on them. Off-schema keys and values are refused.
