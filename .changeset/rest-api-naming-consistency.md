---
'@getmunin/backend-core': minor
'@getmunin/agent-runtime': patch
'@getmunin/dashboard-pages': patch
---

Rename REST control-plane routes for naming consistency, following the same
`<module>/<resource>` + spelled-out-verb conventions used across the rest of the `/v1` surface:

- `v1/cms-drafts/*` → `v1/cms/drafts/*` (nest under the module like `crm/segments`, `kb/spaces`)
- `v1/curation/jobs/*` → `v1/curator/jobs/*` (match the module name; frees "curation" to mean only the KB-nested qualifier)
- `v1/curator/jobs/:id/ack` → `:id/acknowledge` (match `system/alerts/:id/acknowledge`; no more clipped verb)
- `v1/admin/audit-logs` → `v1/audit-logs` (drop the lone `admin/` tier — every other admin resource sits directly under `v1/`)
- feedback "reject" → "dismiss" to match the proposal-queue convention (`dismiss` everywhere else): REST `v1/feedback/:id/reject` → `:id/dismiss`, **and** the MCP tool `feedback_reject` → `feedback_dismiss`.

The two controllers that both mounted `v1/usage` are merged into a single `UsageController`
(routes unchanged — non-breaking).

Breaking for REST clients pinned to the old paths and MCP clients pinned to `feedback_reject`.
No deprecation aliases.
