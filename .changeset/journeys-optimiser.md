---
'@getmunin/backend-core': minor
'@getmunin/db': minor
'@getmunin/types': minor
'@getmunin/dashboard-pages': minor
---

Journey optimiser: a `split` can name a `control` path and a `sampleSize`; once the sample is full everyone goes to the control, and `journeys_get_split_results` reports goal conversion, lift and a two-proportion p-value per path with a winner when one significantly beats the control. `journeys_propose_change` opens a draft version of a live journey with its hypothesis, rationale and evidence, validates and dry-runs it, and never publishes; the dashboard marks such versions as proposed. A weekly curator sweep runs `skill://journeys/optimise-journey` only for orgs with a live journey that set `settings.optimiser: "weekly"`.
