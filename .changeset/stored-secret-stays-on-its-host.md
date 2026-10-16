---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
'@getmunin/agent-host': patch
---

A stored connector secret, mail password or LLM provider key is no longer sent to a host it was not entered for. Before, an update that changed a connection's address kept the stored secret, so the next call sent it to the new host. That turned "agents never see credentials" into two tool calls for a prompt-injected agent.

- `connectors_update_connection` and `PATCH /v1/connectors/:id` refuse a change that moves a connection to a different origin unless the secret is supplied in the same change. The error is `connectors_secret_required`. This covers a custom MCP `url`, Magento and Gastroplanner `baseUrl`, and Shopify `shopDomain`. Adapters mark these fields with the new `endpoint` flag on `ConnectorConfigFieldInfo`, which `/v1/connectors/vendors` now returns. A different path or letter case on the same origin keeps the secret.
- `conv_configure_email_channel` refuses a changed SMTP or IMAP `host` unless that transport's password comes with the change. The error is `conv_secret_required`.
- `PUT /v1/agent-config` refuses a `providerBaseUrl` on a different origin when an org key is stored and no new `providerApiKey` comes with it. The error is `agent_config_key_required`. The check runs before the key is decrypted, so neither the credential probe nor the model list ever reaches the new host. A path change on the same origin keeps the key, and an org with no stored key, or one clearing its key in the same change, can change the URL freely. Before, switching provider presets re-sent the old key to the new provider to validate it.
- The dashboard asks for the secret again once the address changes: in the connector dialog, the email channel dialog, and the AI provider card on the setup wizard and AI settings page. All three error codes have English and Norwegian messages.

The agent path is unchanged in one respect: secrets are still rejected there. An agent moves a connection by deleting it and creating it again, which returns a fresh credential link, or leaves the change to a person in the dashboard.

`ResolvedProviderAuth` is now a union: a `managed: true` result must carry its own `baseUrl`. The runner no longer falls back to the org's `providerBaseUrl` for a managed key. If a host's `resolveProviderAuth` returns a managed key without a base URL, the runner logs an error and does not start, instead of sending a deployment-supplied key to an address the tenant chose. **Hosts that pass `resolveProviderAuth`** must include `baseUrl` on every managed result. TypeScript callers get a compile error until they do.
