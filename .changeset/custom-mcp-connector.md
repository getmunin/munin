---
'@getmunin/backend-core': minor
'@getmunin/agent-runtime': minor
'@getmunin/agent-host': minor
'@getmunin/dashboard-pages': minor
'@getmunin/core': minor
'@getmunin/db': minor
---

Custom MCP connector: connect any proprietary system as a live tool source for the support agent.

Orgs can now point Munin at an MCP server they host themselves (`vendor: "custom-mcp"`, new `mcp` connector domain). While the in-house agent handles a conversation, the remote server's tools are composed alongside the built-in ones under an `ext_<connection>_` namespace, so the agent can answer from the org's own system of record — subscriptions, memberships, internal CRM data — without Munin persisting any of it.

The trust model externalizes the discipline the built-in self-service tools already follow: remote tools take no identity parameters. Munin sends a short-lived ES256-signed identity assertion (`X-Munin-Identity` JWT with `email`/`email_verified`, gated by the same visitor-email rules as `requireEndUserEmail`) on every call, verifiable against a new public per-org JWKS endpoint (`/v1/public/connectors/:orgId/jwks`, keys minted lazily into the new `connector_signing_keys` table). Remote listings are capped at 20 tools, descriptions are sanitized and truncated before reaching the model, results stay fenced as untrusted data, all outbound traffic goes through the SSRF-guarded fetch (new `safeFetchCompat` in `@getmunin/core`), and a down or slow server degrades to "agent runs without those tools" — never a failed conversation.

Setup follows the existing connector flow (credential link for the bearer token, `connectors_test_connection` probes the server and lists its tools), the dashboard Integrations page gets a Custom MCP card, and `skill://connectors/connect-custom-mcp-server` documents the server contract with a reference implementation to hand to the customer's developers.
