---
'@getmunin/backend-core': minor
---

Add the claim and submit endpoints for the out-of-process NER annotation worker. `POST /v1/pii/annotations/claim` leases conversation messages whose detector version is missing or older than the worker's, across every org, and `POST /v1/pii/annotations/submit` stores the person names the worker found. Both sit behind a deployment-scoped `MUNIN_PII_WORKER_SECRET` and the opt-in `MUNIN_PII_NER_ENABLED`, and every read and write runs under the owning org's tenancy. A model upgrade is a version bump: the sweep re-annotates history on its own, and a stale worker can never overwrite newer results.
