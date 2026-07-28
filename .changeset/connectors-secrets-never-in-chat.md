---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': patch
---

Connector secrets can no longer transit the conversation

`connectors_create_connection` and `connectors_update_connection` now reject secret
config fields outright — the only way a secret enters Munin from an agent flow is the
one-time credential link. Creating a connection returns the link directly; the
`connect-external-system` skill is rewritten around that flow (its examples previously
showed pasting `accessToken` into the tool call, which is why agents offered chat
paste as an option).

Two credential-link dead ends are fixed alongside:

- A pending connection missing required non-secret config (e.g. Shopify without
  `shopDomain`) is now rejected at create time with the missing keys named, instead of
  minting a link whose save step can never validate.
- The credential-entry page keeps the one-time token on a failed save (the server
  only consumes it on success), so it now offers a retry that resets the form instead
  of stranding the user on an error. Also drops the doubled top padding on the
  status states.
- The Shopify adapter's default Admin API version moves from the sunset `2025-01`
  to `2026-04`.
