---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

feat(widget): in-tree chat widget — drop-in `<script>` for self-hosted Munin

Self-hosted Munin now serves a first-party browser chat widget directly
at `https://<host>/widget.js`. Operators don't need a token-mint proxy,
a separate hosting target, or the old `chat-widget-vanilla` example —
they create a chat-widget channel in the dashboard, copy the embed
snippet from **Settings → Channels → Embed snippet**, and paste it on
their site.

**`@getmunin/backend-core`**

- Per-channel `identityVerificationSecret` + `requireVerifiedIdentity`
  flag on `WidgetChannelConfig`. The secret is generated at channel
  creation, surfaced once via `conv_widget_create_channel`, and rotatable
  via the new `conv_widget_rotate_identity_secret` MCP tool.
- `verifyIdentity()` runs on every widget request: timing-safe HMAC check
  on the `(verifiedExternalId, userHash)` pair against the channel's
  secret. Failures collapse to a single `403 identity_verification_failed`
  so callers can't distinguish failure modes by status or timing.
- `originAllowlist` is now enforced on `POST /api/v1/widget/messages` —
  browser callers must declare an `Origin` on the channel's allowlist;
  server-to-server callers (no `Origin`) pass through unchanged.
- New `GET /api/v1/widget/messages?since=` endpoint for WS-reconnect
  backfill. Capped at 100, returns `hasMore`. Verified mode binds the
  result set to the requester's externalId (mismatch returns empty
  rather than 403 to avoid leaking session existence).
- `RealtimeGateway` learns a `widget` subscription type. Widget keys
  authenticate at upgrade with origin-allowlist + HMAC identity gates;
  subscriptions are scoped to `widget:<channelId>:<sessionId>`.
  Operator-side replies fan out via a per-connection conversation-meta
  cache, no upstream emit-site changes needed.
- Bidirectional `typing` events: visitor ↔ operator, server-side throttle
  of 1 broadcast per 1.5 s per (sender, conversation), 5 s auto-clear if
  the sender goes silent. `requireVerifiedIdentity` is honored for both
  sides.
- Inbound WS frames capped at 64 KB.
- Backend serves the bundle: `GET /widget/<sha>.js` is immutable
  (`max-age=31536000, immutable`); `GET /widget.js` is a 302 redirect to
  the current sha with `max-age=300, must-revalidate`. The redirect
  target is read from `manifest.json` and refreshed on file mtime change
  so deploy-time swaps propagate without restart. Path traversal is
  blocked; missing manifest yields 503 `no-store`.
- Visitor-message body capped at 1000 chars (`role: end_user`); operator
  / agent / system messages keep the prior 50K cap.
- New REST surface for the dashboard: `requireVerifiedIdentity` on the
  create/update bodies and `POST .../widget/:id/rotate-identity-secret`.

**`@getmunin/dashboard-pages`**

- The Channels page now surfaces the identity-verification secret on
  channel creation alongside the widget API key (one combined callout,
  shown once).
- New per-chat-channel actions: **Embed snippet** (a dialog with a
  copyable `<script>` tag pre-filled with the dashboard origin and
  channel id, plus tabbed Node / Ruby / PHP / Python snippets for
  computing `data-user-hash` server-side) and **Rotate identity secret**.

**Companion changes**

- A new `@getmunin/chat-widget` workspace package (private, deployable
  artifact like `apps/backend` and `apps/web`; not published to npm)
  hosts the widget source. Built as a single content-hashed IIFE bundle
  via Vite, copied into `apps/backend/public/widget/` by a `prebuild`
  step.
- The standalone `chat-widget-vanilla` example in the `munin-examples`
  repo is removed — the dashboard's embed snippet replaces it.
