---
'@getmunin/backend-core': major
---

refactor(api)!: version every JSON endpoint under /api/v1

Pre-launch cleanup of the HTTP API surface. Stamps `/api/v1/...` on
every JSON endpoint and locks in conventions before any external
client embeds a URL.

**Breaking** for every API consumer. Excluded paths are unchanged:
`/healthz`, `/readyz`, `/version`, `/auth/*`, `/static/assets/*`, and
`/mcp` (which lives on the `mcp.getmunin.com` subdomain in production
and uses the host as its namespace).

Notable structural moves:

- `/whoami` → `/api/v1/whoami`
- `/api/audit-log` → `/api/v1/admin/audit-logs` (admin-prefixed, plural)
- `/api/orgs/me/memberships` → `/api/v1/me/memberships` (it lists the user's orgs, not the active org's data)
- `/api/end-user/conversations/...` → `/api/v1/end-users/me/conversations/...`
- `/api/conv/...` → `/api/v1/conversations/...` (abbreviation spelled out)
- `/api/conv/widget/messages` → `/api/v1/widget/messages` (avoids a `:id` collision with `/api/v1/conversations/:id/messages`)
- `/api/curator/jobs` → `/api/v1/curation/jobs`
- `/api/inbox/queue` → `/api/v1/inbox`
- `/api/cms/v1/...` → `/api/v1/cms/...` (collapsed inner version)
- `/api/realtime` (WebSocket) → `/api/v1/realtime`
- `/api/delegated-token` → `/api/v1/tokens/delegated`

Verb fixes:

- `POST /api/tokens/:id/revoke` → `DELETE /api/v1/tokens/:id`
- `POST /api/conv/channels/widget/:id` (update) → `PATCH /api/v1/conversations/channels/widget/:id`
- `POST /api/crm/segments/:id` (update) → `PATCH /api/v1/crm/segments/:id`
- `DELETE /api/kb/curation/candidates/:id` (dismiss) → `POST .../candidates/:id/dismiss`

`api-keys` and `tokens` stay as separate sibling resources because they map to different DB tables (`schema.apiKeys` vs `schema.tokens`); delegated-token mint moves under `/tokens/delegated` since it writes to `schema.tokens`.
