---
'@getmunin/backend-core': patch
'@getmunin/core': patch
'@getmunin/db': patch
---

feat(oauth): pin OAuth/MCP agent connections to an organization

OAuth agents used to float to the user's current default org, resolved live on every request — so the flock listed an agent under whichever org happened to be default, switching the default silently retargeted live agents, and revoke was user-global.

Connections are now pinned to a specific org at consent time via BetterAuth's `consentReferenceId`, which persists the org as `reference_id` on the refresh token and as an `org_id` claim on the issued JWT access token (carried forward on refresh). The credential resolvers read that pinned org and require the user to still be a member of it — removing someone from an org now kills their agents there. Tokens issued before this change fall back to the default org and are backfilled by a migration.

As a result the flock is truthful per-org (lists only agents pinned to the calling org) and revoke is org-scoped (only revokes grants pinned to the caller's org, leaving the same user's other-org agents alone). Which org an agent binds to is the user's active org at consent time, set with the existing topbar org switcher.
