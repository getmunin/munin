---
'@getmunin/backend-core': patch
---

Mark the Slack webhook controllers (`/v1/slack/events`, `/v1/slack/interactivity`, `/v1/slack/oauth/*`, `/v1/slack/avatars`) as anonymous-callable via `PublicController`. Deployments that register `AuthGuard` as a global `APP_GUARD` were returning 401 "invalid or expired credential" to Slack before signature verification ever ran, which broke button interactions and inbound event delivery. Slack authenticates these routes with its signing secret (and the OAuth callback with signed state + a nonce cookie), not a Munin credential. The events/interactivity endpoint is now also rate-limited like other public webhook endpoints.
