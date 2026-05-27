---
'@getmunin/dashboard-pages': minor
'@getmunin/backend-core': patch
---

Rename the Partner-access settings nav label key and adjust the MCP
tool-name guard test.

- `dashboard-pages`: `nav.partnerAccess` → `nav.partner` (en + nb). The
  cloud overlay now uses `labelKey: 'partner'` and a shorter "Partner"
  label, moved from the Workspace group to Access & integrations.
- `backend-core`: the OSS MCP integration test's negative assertion is
  updated to `feedback_create` to match the cloud-feedback module's
  renamed tools (`suggestion_*` → `feedback_*`). OSS behavior is
  unchanged — the guard still verifies cloud-only tools don't leak.

No production users yet, so no backwards-compat aliasing.
