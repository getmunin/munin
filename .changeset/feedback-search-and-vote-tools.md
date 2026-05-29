---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': patch
---

Extend the feedback MCP surface with global roadmap search and voting.

- `feedback_search` queries the public Munin roadmap (`GET /v1/public/feedback`) so agents can find an existing item to vote on before filing a duplicate. Supports `q`, `appScope`, `status`, `sort` (`votes`|`recent`), and `limit` (≤100).
- `feedback_vote` casts the instance's vote on a published item via the HMAC-signed `POST /v1/public/feedback/:id/vote` endpoint. Idempotent on `(feedbackId, instanceId)`; surfaces 404 (item missing or not public) and 429 (per-instance quota) as typed errors.
- `FeedbackForwarder` keeps a single HTTP entry point for submit/search/vote; reuses the existing `munin-feedback-intake-v1` HMAC derivation so both directions share one key and constant.
- OSS landing page gains a "Read the docs →" link under the Get started / Sign in buttons (en + nb).
