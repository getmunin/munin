---
'@getmunin/backend-core': minor
'@getmunin/types': minor
---

Webhook management is now available to AI agents via MCP. Adds seven `webhooks_*` tools (`list`, `create`, `update`, `delete`, `rotate_secret`, `list_deliveries`, `list_event_types`) backed by a new `WebhooksService` that the existing REST controller at `/v1/webhooks` also delegates to. The controller gains `POST :id/rotate-secret`, `GET :id/deliveries`, and `GET event-types` endpoints. Tools follow the system-alerts convention (`audiences: ['admin']`, `scopes: []`) — no new OAuth scopes were introduced.

Adds `cms_upload_asset_from_url`: server-side fetches an HTTPS asset and stores it as a CMS asset in one call. Bypasses the presigned-PUT + base64 round-trips that some agent sandboxes (e.g. ChatGPT/Claude workspaces) cannot complete. Guarded by `safeFetch` (SSRF, redirect cap, 15s timeout), a 50 MB streamed size cap (Content-Length is not trusted), and a MIME allowlist (`image/*`, `video/*`, `audio/*`, `application/pdf`; SVG remains rejected). The original URL is recorded in `metadata.sourceUrl`.

Consolidates webhook event-type strings in `@getmunin/types`: new exports `CMS_EVENT_TYPES`, `CRM_EVENT_TYPES`, `KB_EVENT_TYPES`, `CONVERSATION_EVENT_TYPES`, `OUTREACH_EVENT_TYPES`, `SYSTEM_EVENT_TYPES`, `EVENT_TYPES_BY_MODULE`, `KNOWN_EVENT_TYPES`, and `isKnownEventType`. The dispatcher's `emit({ type })` still accepts arbitrary strings; the catalog is the source of truth for `webhooks_list_event_types` and is available for typed consumers going forward.

Realtime gateway now sends `{ type: 'read_ack', conversationId, messageIds }` to the originating socket after a `read` frame's `conv_message_reads` INSERT commits. All existing WebSocket consumers (chat-widget, dashboard, agent-runtime) silently ignore unknown frame types, so this is additive. The widget integration test for `conv_message_reads` waits for the ack instead of `setTimeout(200)`, eliminating a CI flake.