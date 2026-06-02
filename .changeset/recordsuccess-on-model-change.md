---
'@getmunin/agent-host': patch
---

Saving a new fast or smart model in the agent config now calls `agent_health.recordSuccess`, the same recovery path that already runs after a successful API-key validation. If the agent was degraded with `model_not_found` (or any other model-level error), the admin can recover it by picking a different model — previously only an API-key edit cleared the degraded status. Same-value patches don't trigger the call, so a noop save still won't fake-recover a truly broken agent.
