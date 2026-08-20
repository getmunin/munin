---
'@getmunin/backend-core': patch
---

Fix `DELETE /v1/tokens/:id` for OAuth agents. The handler recognised OAuth refresh-token rows by an `orft_` id prefix, which only Drizzle's column default produces — BetterAuth's OAuth provider writes those rows through its own adapter with its own id generator, so live rows never carry the prefix. Every revoke therefore fell through to the unrelated `tokens` table, matched nothing, and returned `token <id> not found`, making the Revoke button on the Agents page fail for all connected agents. Revoke now looks the id up in `oauth_refresh_token` first and only falls back to the `tokens` table when there is no match, so wrong-org callers still get a 404.

The existing integration test passed because it seeded rows through Drizzle and asserted the prefix; it now seeds BetterAuth-shaped ids and reproduces the production 404.
