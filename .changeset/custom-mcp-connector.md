---
'@getmunin/backend-core': minor
'@getmunin/agent-runtime': minor
'@getmunin/agent-host': minor
'@getmunin/dashboard-pages': minor
'@getmunin/ui': minor
'@getmunin/docs-pages': minor
'@getmunin/core': minor
'@getmunin/db': minor
---

Custom MCP connector: connect any proprietary system as a live tool source for the support agent.

Orgs can now point Munin at an MCP server they host themselves (`vendor: "custom-mcp"`, new `mcp` connector domain). While the in-house agent handles a conversation, the remote server's tools are composed alongside the built-in ones under an `ext_<connection>_` namespace, so the agent can answer from the org's own system of record — subscriptions, memberships, internal CRM data — without Munin persisting any of it.

The trust model externalizes the discipline the built-in self-service tools already follow: remote tools take no identity parameters. Munin sends a short-lived ES256-signed identity assertion (`X-Munin-Identity` JWT) on every call, verifiable against a new public per-org JWKS endpoint (`/v1/public/connectors/:orgId/jwks`, keys minted lazily into the new `connector_signing_keys` table).

The assertion deliberately carries no `verified` boolean. It reports `email_provenance` / `phone_provenance` — `authenticated` (identity-verified widget session or delegated token), `channel_asserted` (an email `From:`, SMS sender or caller ID, all spoofable), or `self_reported` (typed by an anonymous visitor) — and the receiving server decides what each level may disclose. Provenance is computed from the channel the current turn arrived on, not from the end-user record, so an identity that was authenticated once in the widget is still reported as `channel_asserted` when someone later emails claiming to be that person. Unknown channels fall back to `channel_asserted` rather than over-claiming.

Because the connected server is a *customer-facing* tool source rather than a toolbox for admin agents, a connection exposes nothing by default: only tool names listed in the connection's `allowedTools` reach a conversation, a call to a withheld tool is refused even if the model guesses the name, and a server with an empty allow-list stays connected and silent. `connectors_test_connection` reports what the server offers versus what is actually exposed, warns about exposed tools the server has not marked read-only, and flags allow-listed names the server does not provide.

Remote listings are capped at 20 tools, descriptions are sanitized and truncated before reaching the model, results stay fenced as untrusted data, all outbound traffic goes through the SSRF-guarded fetch (new `safeFetchCompat` in `@getmunin/core`), and a down or slow server degrades to "agent runs without those tools" — never a failed conversation.

Setup follows the existing connector flow (credential link for the bearer token, `connectors_test_connection` probes the server and lists its tools), the dashboard Integrations page gets a Custom MCP card, and `skill://connectors/connect-custom-mcp-server` documents the server contract with a reference implementation to hand to the customer's developers.

`skill://connectors/connect-external-system` also gains the same caveat for the built-in commerce and bookings connectors, whose self-service tools have always trusted an inbound email `From:` header or SMS sender the same way: fine for order status, not sufficient on its own for anything whose disclosure to the wrong person causes real harm.

`SectionHead` in `@getmunin/ui` gains an optional `subtitle` slot, and the Integrations page's private copy of that component is deleted in favour of it — the copy had drifted to a smaller heading than every other settings page used.

The docs site gains an Integrations guide category and a "Connect your own system" guide covering the customer-facing warning, the allow-list flow and the provenance levels — the first guide-level documentation for connectors of any kind.
