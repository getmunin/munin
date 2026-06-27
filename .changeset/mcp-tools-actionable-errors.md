---
"@getmunin/backend-core": patch
"@getmunin/mcp-toolkit": patch
---

Fix MCP tools that returned a bare `500 Internal server error` or an invalid result on otherwise-valid input. Database constraint violations are now caught before they fire and surface as actionable tool errors:

- `crm_create_segment` — duplicate segment name now returns `crm_conflict` instead of a 500.
- `conv_create_topic` — duplicate slug now returns `conv_topic_slug_conflict` instead of a 500.
- `cms_create_locale` — duplicate locale code now returns `cms_locale_conflict` instead of a 500.
- `crm_delete_segment` — deleting a segment referenced by an outreach campaign now explains the conflict (and how to resolve it) instead of a 500.
- `conv_assign_conversation` — assigning to a user who is not a member of the org now returns a clear `conv_invalid` error instead of a 500.
- `webhooks_delete` — now returns `{ deleted, id }` instead of nothing; a void return serialized to `undefined` content and tripped the MCP `CallToolResult` schema (`-32602`).

The MCP dispatch layer also coalesces a void tool return to a valid `null` text result so a future void-returning tool can't produce a transport-level error.
