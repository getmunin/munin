---
'@getmunin/backend-core': patch
---

**Security**: harden chat-widget rate limiting and origin enforcement.

- **Throttler key**: drop caller-controlled `sessionId` from the tracker key.
  The widget previously bucketed by `ip|channelId|sessionId`, so an embed
  that rotated session IDs through the same IP could open unbounded
  conversations. The key is now `apiKeyId|channelId|ip` — independent of
  session and indexed by the resolved widget credential.
- **Trusted IP**: the guard now reads `req.ip` (which honours Express's
  `trust proxy` setting) instead of parsing `x-forwarded-for` directly. New
  `MUNIN_TRUST_PROXY` env (forwarded to `app.set('trust proxy', …)`) lets
  deployments behind a load balancer / CDN trust their proxy hop and have
  `req.ip` reflect the real client. Left unset, Express trusts no proxy
  and `req.ip` is the socket address — so an unproxied app no longer
  honours a spoofed XFF.
- **Origin allowlist (opt-in strict mode)**: `enforceOriginAllowlist` keeps
  the dev-friendly default (empty allowlist allows any origin) but now
  rejects when `MUNIN_WIDGET_REQUIRE_ALLOWLIST=1` is set. Production
  deployments should set it.
