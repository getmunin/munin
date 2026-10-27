---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

A new playbook, `skill://playbooks/trial-onboarding`, walks an agent through launching a trial onboarding journey: the product events it needs, a ready-to-use spec (welcome email, a five-working-day wait, an invitation check, a sales flag for decision-makers, a help email with a reply path, and a subscription goal), validation, simulation, the publish hand-off and a two-week watch until the first-journey gate is met.

Journey reports gain a run-integrity block — steps that sent more than one email and people with no logged step — shown on the report tab; both should stay at zero. Simulation assumptions are now structured (`code`, `nodeId`) and the publish dialog shows them in the viewer's language.
