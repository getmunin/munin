---
'@getmunin/agent-host': minor
'@getmunin/backend-core': minor
---

Drop the runner's loopback HTTP path and remove the auto-minted admin API
key.

The agent-host runner used to call its own backend over HTTP for a handful
of `/api/v1/conversations/*` and `/api/v1/curator-jobs/*` endpoints. Those
calls required a bearer token, so an `AutoMintAdminKeyProvider` created an
`mn_admin_*` API key named `agent-host-runner` per org/config and stored the
ciphertext on `agent_config.admin_api_key_ct`. The key showed up in the
dashboard's API-keys settings; a user revoking it silently broke the runner.

This release replaces the loopback HTTP path with an in-process implementation
of `MuninRestClient` (`InProcessMuninRestClientFactoryService` in
`@getmunin/backend-core`). The runner now calls Nest services directly,
wrapped in `runWithServiceContext` and an `AuditLogger` that records
`runner:*` audit rows. No bearer token is needed.

**Breaking** (internal: only affects code embedding `AgentHostModule` directly):

- `AgentHostModule.forRoot({ adminKeyProvider })` option is removed. Drop it
  from your module config.
- `AgentHostRunnerOptions.baseUrl` and `.fallbackAdminApiKey` are removed.
- `AutoMintAdminKeyProvider`, `AdminKeyProvider`, and `NoopAdminKeyProvider`
  exports are removed.
- `AgentConfigRepository.readDecryptedAdminKey` and `AgentConfigRow.adminApiKeyId`
  are removed from the interface.
- The `AGENT_HOST_SINGLETON_DDL` / `AGENT_HOST_MULTI_TENANT_DDL` migrations
  now drop `agent_config.admin_api_key_ct` and `admin_api_key_id`, and
  revoke any existing `api_keys` rows with `name = 'agent-host-runner'`.

The HTTP `createMuninRestClient` factory remains exported from
`@getmunin/agent-runtime` — embedders running the runtime outside Nest can
still use it.
