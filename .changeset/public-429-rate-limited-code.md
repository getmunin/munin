---
'@getmunin/backend-core': minor
'@getmunin/types': minor
---

Make a throttled public route answer with a 429 a caller can recognise.

Every `PublicController(..., { throttle: true })` route — the CMS delivery API, the analytics beacons, the public catalogs — used to answer `{"statusCode":429,"message":"ThrottlerException: Too Many Requests"}`, with no `code` and no plain `Retry-After`: `@nestjs/throttler` suffixes its headers with the throttler name (`Retry-After-public-minute`), so a generic client finds nothing to back off on. The body now carries `code: 'rate_limited'` and `retryAfterSeconds`, the message names the limit and the window it applies to, and an unsuffixed `Retry-After` is set alongside the per-bucket headers.

This matters most for the delivery API, whose consumer is a build or a server renderer rather than a person. A frontend that folds every non-OK response into an empty list turns a rate limit into "the collection is empty", and the failure then gets attributed to the org id or an unreachable API — neither of which is wrong. `RATE_LIMITED_CODE` is exported from `@getmunin/types` so a consumer can branch on it without string-matching, and `RateLimitExceededError` (the per-org MCP limit) now uses the same constant.
