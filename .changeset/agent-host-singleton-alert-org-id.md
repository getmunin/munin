---
'@getmunin/agent-host': patch
---

Fix `org_alerts` insert failure when the agent-host records a provider outage in singleton mode. `runWithServiceContext` was seeding the actor's `orgId` from the config id (`'singleton'`), which violates the `org_alerts.org_id` → `orgs.id` foreign key. The function now accepts an explicit `{ orgId }` override, and the four alert-touching call sites in `AgentHostRunner` (`onProviderError`, `onProviderSuccess`, and the curator worker's success/failure paths) thread through the resolved org id. Also fixes the symmetric latent bug where `recordSuccess` never auto-resolved the alert because `resolveAlert` was scoped to `org='singleton'` and found nothing.
