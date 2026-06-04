---
'@getmunin/backend-core': minor
---

Export `RateLimitService`, `RateLimitExceededError`, and the `Bucket` type
from the public surface so downstream backends (notably the cloud
`QuotasService` override) can record into `rate_limit_counters` directly.
