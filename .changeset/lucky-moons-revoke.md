---
'@getmunin/backend-core': patch
---

Fix `DELETE /v1/tokens/:id` for OAuth agents. The handler recognised OAuth refresh-token rows by an `orft_` id prefix, which only Drizzle's column default produces — BetterAuth's OAuth provider writes those rows through its own adapter with its own id generator, so live rows never carry the prefix. Every revoke therefore fell through to the unrelated `tokens` table, matched nothing, and returned `token <id> not found`, making the Revoke button on the Agents page fail for all connected agents. Revoke now looks the id up in `oauth_refresh_token` first and only falls back to the `tokens` table when there is no match, so wrong-org callers still get a 404.

The existing integration test passed because it seeded rows through Drizzle and asserted the prefix; it now seeds BetterAuth-shaped ids and reproduces the production 404.

Fix the same wrong assumption in `GET /v1/usage/by-agent`, which filtered audit actor ids down to those starting with `usr_` before resolving them against `users`. No BetterAuth-created user id carries that prefix either, so the lookup always came back empty: OAuth agent rows lost the authorising person's sub-label, and a dashboard user's own calls were listed under their raw 32-character id instead of their name. The lookup now runs against every actor id, as the activity feed already did. Its test seeded users through Drizzle too and is likewise switched to BetterAuth-shaped ids.
