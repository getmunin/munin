---
'@getmunin/backend-core': patch
---

Connectors: run the vendor credential probe outside the DB transaction. Credential handoff now persists secrets in a short transaction, then verifies them (the vendor round-trip) after commit via a new optional `CredentialTargetHandler.verify` hook, so the public `/v1/credentials` completion no longer holds a pooled Postgres connection open across a slow vendor call.
