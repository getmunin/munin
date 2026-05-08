---
'@getmunin/agent-host': patch
---

fix(agent-host): set app.crypt_key in service-role context + use actor orgId for auto-minted keys

Two bugs surfaced while smoke-testing the bundled runner end-to-end:

1. `runWithServiceContext` set `app.bypass_rls` but not
   `app.crypt_key`, so the runner's reconcile path crashed when
   trying to decrypt the provider API key (`unrecognized configuration
   parameter "app.crypt_key"`). Now reads `MUNIN_ENCRYPTION_KEY` and
   sets the GUC alongside `bypass_rls`.

2. `AutoMintAdminKeyProvider.mint` inserted into `api_keys` with
   `orgId: configId`. That worked for cloud (configId === orgId) but
   broke for OSS singleton (configId === 'singleton', not a real
   org). Now resolves orgId from the actor on the request context.
