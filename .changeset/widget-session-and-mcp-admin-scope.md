---
"@getmunin/core": minor
"@getmunin/backend-core": minor
"@getmunin/chat-widget": minor
---

Security hardening from a follow-up audit.

- **Widget session credential moved out of the URL (BREAKING):** the widget read endpoints (`GET /v1/widget/messages`, `GET /v1/widget/conversations`, `GET /v1/widget/voice/available`) no longer accept the session credential in the query string. `sessionId`, `sessionIds`, `verifiedExternalId`, and `userHash` must now be sent as the `x-munin-session-id`, `x-munin-session-ids`, `x-munin-verified-external-id`, and `x-munin-user-hash` request headers. This keeps the session token — which grants read/write on a visitor's conversation — out of server, proxy, and CDN access logs. The bundled chat widget is updated; any custom integration that called these GET endpoints must move the fields from the query string to headers.
- **Widget origin allowlist is required by default (BREAKING):** a widget channel with an empty `originAllowlist` now rejects all traffic, and creating one without an allowlist fails, unless `MUNIN_WIDGET_REQUIRE_ALLOWLIST` is explicitly set to `0`/`false`. Previously the allowlist was only enforced when the flag was opted in. Existing widget channels without an allowlist stop accepting requests until their origins are configured (or the flag is disabled). This inverts the default to fail-closed.
- **OAuth `mcp:admin` scope is gated by org role (BREAKING):** OAuth access tokens (opaque and JWT) issued to users whose org membership role is not `owner` or `admin` no longer carry the `mcp:admin` scope or the admin MCP audience — they resolve to the self-service surface. Previously any member who consented to an `mcp:admin` scope grant reached every admin MCP tool. Admin API keys (`mn_admin_*`) are unaffected.
- **Channel webhook endpoint hardened:** `POST /v1/conversations/channels/:channelId/webhook` is now rate-limited (per-IP, like the other public endpoints) and returns a uniform `401` for both unknown-channel and signature-verification failures to prevent channel-id enumeration. Note: an unknown channel now returns `401` instead of `404`.
