---
"@getmunin/backend-core": patch
"@getmunin/chat-widget": patch
"@getmunin/docs-pages": patch
---

fix(widget): keep a signed-in visitor's chats away from the next person on the same browser, and refuse widget keys on `/mcp`

A widget session that a signed-in user has used now belongs to that user everywhere, not only on attachment uploads and `PATCH /v1/widget/visitor`. An anonymous caller, or one verified as a different `externalId`, gets an empty `GET /v1/widget/messages`, does not see the session in `GET /v1/widget/conversations`, receives none of its realtime events or typing indicators, and gets `403 conversation_identity_mismatch` from `POST /v1/widget/messages` and `POST /v1/widget/conversations`. Previously the reads and the realtime socket only checked ownership for verified callers, so after a sign-out on a shared browser the next anonymous visitor reused the stored session id and saw the previous user's conversation. All paths now share one ownership check.

Anonymous widget traffic can no longer attach itself to a signed-in contact: an anonymous visitor who types an email a signed-in contact already uses gets a contact of its own, and an `externalId` placed in `visitor.metadata` is dropped instead of being stored as an identity claim. A new anonymous visitor whose email another end user already holds no longer fails with a 500; the email is left off their record, as it already was for returning visitors.

The chat widget records which user its stored session belongs to. A page that loads without `data-external-id` after a signed-in user, or an `identify` call with a different `externalId`, starts a fresh session with no history. `window.mn.widget.logout()` does the same on demand for sign-outs that don't reload the page. If the server reports that a session belongs to someone else, the widget moves to a new session and resends.

`mn_widget_*` keys are refused on `/mcp` with `403 mcp_widget_key_rejected`, before the per-org burst limiter and daily quota run. No MCP tool accepts the widget's only scope, so the key had no use there, but every call it made counted against the organization's MCP limits and let anyone holding a site's public key throttle its admin clients.
