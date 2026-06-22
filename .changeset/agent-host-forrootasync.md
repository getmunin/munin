---
"@getmunin/agent-host": minor
---

Add `AgentHostModule.forRootAsync({ configRepository, imports, inject, useFactory })` so `runnerOptions` (provider factory, credential resolver, pre-generate gate) can be built from a DI factory with injected services, instead of only a static value.
