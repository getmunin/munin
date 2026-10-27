---
'@getmunin/backend-core': minor
'@getmunin/db': minor
'@getmunin/types': minor
'@getmunin/dashboard-pages': minor
---

Journeys, first part: an agent can now draft a customer journey over MCP. A journey wraps one email outreach campaign and holds a versioned graph of entry triggers, waits, branches, splits, emails, CRM and webhook actions, goals and exits. Fifteen new `journeys_*` tools create a journey, edit its draft node by node, validate it (missing or unreachable nodes, dangling edges, loops that never wait, unknown segments, templates or webhooks, a missing goal), restore earlier versions, and pause, resume or archive it. Published versions never change; every edit opens a new draft.

New OAuth scopes `journeys:read` and `journeys:write` appear on the consent screen. Read-only dashboard routes live under `/v1/journeys`. Journeys do not run yet: publishing and the runtime engine arrive in later releases. A segment used by a journey can no longer be deleted until that journey is archived.
