---
"@getmunin/agent-host": minor
"@getmunin/dashboard-pages": minor
---

The setup/onboarding gate now treats an org as configured when the agent has a usable provider — not only when an org-level API key is set. `/v1/agent-config` exposes `providerConfigured` (`providerApiKeySet` OR a host-supplied `defaultProviderAvailable`), and `AgentHostModule.forRoot`/`forRootAsync` accept a `defaultProviderAvailable` flag. Hosts that supply a default provider can let key-less orgs finish onboarding and reach the dashboard; self-hosted setups (no flag) are unchanged.
