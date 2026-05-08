---
'@getmunin/agent-host': minor
---

feat(agent-host): derive runner activation from provider key presence

The `enabled` column on `agent_config` is gone — having a provider
API key set is the activation signal. This removes a confusing
toggle (a "configured but disabled" state nobody actually wanted)
and makes the wizard simpler: paste a key and the runner starts.

Behavior changes for upgraders:

- Schema: `enabled` column dropped from `agent_config` via
  `ALTER TABLE ... DROP COLUMN IF EXISTS enabled` baked into both
  `AGENT_HOST_SINGLETON_DDL` and `AGENT_HOST_MULTI_TENANT_DDL`.
- Existing rows with `enabled=false AND provider_api_key_ct IS NOT NULL`
  now become active. Operators that explicitly disabled an
  agent-with-creds should clear the provider key instead.
- `AgentConfigRepository.listEnabledIds()` → `listProvisionedIds()`,
  filtering on `provider_api_key_ct IS NOT NULL`.
- `AgentConfigPatch.enabled` and `AgentConfigDto.enabled` removed.
- AdminKeyProvider hook signal: mint fires whenever the admin key
  id is missing while a provider key is set (enables auto-recovery
  for rows where the auto-mint never ran), revoke fires when the
  provider key is cleared.
