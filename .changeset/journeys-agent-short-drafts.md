---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

The agent can write SMS, chat messages and call openings in journeys, not only email. A message step on any channel takes `draftBy: "agent"` with a `brief`; the curator prompt states the channel's shape and limit, and `journeys_submit_draft` makes `subject` optional, requires it only for email, refuses it elsewhere and checks the body against the channel's limit (480 characters for SMS, 2000 for chat, 1000 for a call opening). SMS and calls are still approved by a person whoever wrote them; an agent-written chat step can run `auto` only after it has earned it, like an agent-written email. The `draft-step` skill covers every channel, and the journey graph marks agent-written SMS, chat and call steps.
