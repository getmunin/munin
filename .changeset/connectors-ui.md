---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
'@getmunin/db': minor
---

Connectors management UI and secure credential handoff. The Integrations settings page gains a Data connectors section to list, add, test, and remove connections. Secrets can be entered inline or handed off: creating a connection without its secret returns a one-time link (`/connect/credentials`) a human opens to enter credentials in the dashboard, so secrets never pass through an agent conversation. Backed by a generic `credential_requests` handoff primitive (reusable by other MCP-set-up integrations) and a `/v1/connectors` control-plane API.
