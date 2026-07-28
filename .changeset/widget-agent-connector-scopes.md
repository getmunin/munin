---
'@getmunin/backend-core': patch
'@getmunin/agent-runtime': patch
'@getmunin/agent-host': patch
---

The end-user conversation agent can now reach commerce and bookings connectors: its delegated identity previously carried only conv/kb/crm scopes, so every `commerce_*` and `bookings_*` tool was stripped at the `/mcp` scope intersection and the widget agent deferred to a human even with a configured Shopify or Gastroplanner connection. The in-process runner resolves the connector scopes per conversation from the org's active connections, so orgs without a commerce or bookings connection never see those tools.

Alongside the wider scopes, self-service connector lookups no longer trust self-reported emails: browser-supplied widget emails (first-ingest visitor payload and the save-conversation box) are stamped `emailSource: 'visitor'` on the end-user record, and `requireEndUserEmail` rejects anonymous identities and visitor-sourced emails with `connectors_unverified`. This closes an account-takeover vector where an anonymous chat visitor could claim someone else's email and read their orders or cancel their bookings. Emails asserted by trusted paths — inbound email, SMS/voice caller ID, operator-minted delegated tokens, the admin API — keep working.
