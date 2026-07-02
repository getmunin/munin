---
"@getmunin/analytics-tracker": minor
"@getmunin/backend-core": minor
"@getmunin/dashboard-pages": minor
"@getmunin/core": minor
---

Security hardening from a full audit.

- **Voice tool bridges (Vapi, Threll):** enforce tenancy on every self-service tool call. The bridges previously disabled RLS without setting `app.org_id` and granted wildcard scope, allowing cross-tenant reads/writes; they now apply the standard tenancy GUCs and the restricted self-service scope set.
- **OAuth JWT verification:** pin verification to the algorithm bound to the trusted JWKS key and reject symmetric algorithms, closing an algorithm-confusion gap.
- **Analytics `identify` (BREAKING):** the identity hash now signs `${externalId}:${visitorId}` so a leaked hash can't link a different visitor. Compute `HMAC(secret, "<externalId>:<visitorId>")` where `visitorId` comes from the new `window.mn.getVisitorId()`. The server-rendered `data-external-id`/`data-user-hash` auto-identify is removed — do the read-visitor-id → sign → `window.mn.identify()` round trip instead.
- **Webhook replay guidance:** documented that receivers should reject deliveries whose signed `createdAt` is outside a freshness window (in addition to the existing `x-munin-delivery-id` idempotency). No wire-format change — the signature scheme is unchanged.
- **MCP scopes:** `webhooks_*`, `feedback_*`, and `system_alerts_*` tools now require real `webhooks:*` / `feedback:*` / `system_alerts:*` scopes instead of being gated by audience alone.
- **Capability tokens:** view, unsubscribe, and email-open tokens now enforce a max age (and reject future-dated tokens), preventing indefinite replay of leaked links.
- **Tool hints:** `conv_test_channel` and `conv_test_email_channel` are marked destructive (they open outbound vendor connections) so they prompt before running.
- **Input validation:** a caller-supplied `endUserId` is validated against the caller's org in delegated-token minting and `crm_create_contact`.
