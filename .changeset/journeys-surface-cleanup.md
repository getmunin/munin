---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': patch
---

Journey tools, the journey editor and their copy are tidied up.

- **`journeys_preview_move_enrollments`** (read-only, `journeys:read`) previews moving open runs to another version; `journeys_move_enrollments` now requires the preview's `fingerprint` and only moves.
- **`journeys_validate`** is read-only and needs only `journeys:read`.
- **Every draft edit tool takes `ifSpecHash`** (`journeys_replace_draft`, `journeys_add_node`, `journeys_update_node`, `journeys_remove_node`, `journeys_update_settings`), refusing with `journeys_draft_changed` when the draft changed since, as the dashboard already did.
- **Node shapes are checked in the service**, so `/v1` and MCP refuse the same malformed node with the same `journeys_invalid` message.
- **Review links are org-scoped.** `journeys_request_publish` and `journeys_get_template_changes` return `reviewPath` scoped to the organization where the dashboard is, plus an absolute `reviewUrl`.
- Tool descriptions no longer direct the agent to other tools, `journeys_list_node_types` lists every settings field, and `journeys_create_from_campaign` says the campaign is locked while the journey exists.
- **Editor.** A draft that can't be drawn lists its steps so a person can still open one in the advanced editor; a step form that would save an incomplete node says what is missing instead of sending it. New steps start with text in the dashboard's language, and the graph's step labels are translated.
- The inbound-lead template's follow-up email no longer ends on a sentence that points at nothing.
- Norwegian copy uses "kundereise" throughout and one word for runs, and a paused journey shows as "Pauset".
