---
'@getmunin/backend-core': patch
---

Fix the AuthGuard and RealtimeGateway routing delegated end-user tokens
(`mn_dlg_*`) to `resolveApiKey` because they match the generic
`mn_<kind>_*` shape. `resolveApiKey` only queries the `api_keys` table,
so delegated tokens never resolved and every protected endpoint
(including `/mcp` and `/api/realtime`) returned 401 when called with a
freshly minted delegated token.

Tokens with the `mn_dlg_` prefix now route to `resolveBearerToken`
directly, which queries the `tokens` table where they actually live.

The integration test fixtures were using bare 32-byte random tokens
(no `mn_dlg_` prefix) for delegated-token cases, which masked the bug.
Updated those fixtures to use `buildApiKey('dlg')` so they exercise the
real prefix routing path.
