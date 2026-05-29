---
'@getmunin/backend-core': minor
---

Make row-count quotas opt-in via `MUNIN_QUOTAS_ENABLED`.

OSS self-hosters on their own hardware were being capped at the cloud free-tier ceilings (10K KB docs, 100 KB spaces, 50 CMS collections, 10K CMS entries, 1K CMS assets) because `QuotasService.assertCanAdd` ran unconditionally. The defaults make sense for a tiered SaaS but not for someone running Munin on their own box.

`assertCanAdd` now no-ops unless `MUNIN_QUOTAS_ENABLED=true`. Set it in cloud deployments to keep the existing behavior; leave it unset (or `false`) on self-hosted instances. The per-org `orgs.settings.quotas.<resource>` override path is unchanged.
