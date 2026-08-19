---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
'@getmunin/core': patch
'@getmunin/db': patch
---

Attribute MCP activity to the agent that made it.

The usage page's "By agent" table was always empty, and the Agents page never showed a last-used time. Both read from identity that was never recorded. OAuth-authorized agents (claude.ai, Claude Code) resolve to `actor_type = 'user'` with `actor_id` set to the authorizing user — deliberately, because their permissions derive from that user's org role — so the by-agent query's `actor_type IN ('admin_agent','end_user_agent')` filter excluded them, and its join against the `agents` table dropped whatever was left: nothing in the codebase ever inserts a row there. Even with the filter widened, `actor_id` could not have separated two connectors authorized by the same person.

`audit_log` now records `client_id`, the OAuth client the credential was issued to, taken from `oauth_access_token.client_id` for opaque tokens and the `azp` claim for JWTs. The by-agent report groups on it (joined to `oauth_client` for the connector name) and no longer consults the vestigial `agents` table; admin API keys, delegated end-user agents and the in-process agent runtime resolve to their own labels instead of being filtered out. Average latency is now a call-weighted mean rather than an average of per-group averages. The Agents page derives last-used from the newest audit row per connector, so it fills in as traffic arrives rather than being hardcoded null.

The audit log's Client column also stops reporting "unknown" for traffic it can identify: browser requests classify as `dashboard`, widget callers as `widget`, and the transport-level `POST /mcp` row as `mcp` (previously only the row carrying a tool name matched). Where a row has an OAuth client, the column shows the connector's name instead of a coarse bucket.
