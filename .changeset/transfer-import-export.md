---
'@getmunin/backend-core': minor
'@getmunin/core': minor
'@getmunin/dashboard-pages': minor
---

Replace the one-way data export with bidirectional per-module import/export.

Removes the dashboard "Data export" page and `GET /v1/export`. Adds symmetric
`*_export` / `*_import` MCP tools and `/v1/<module>/export|import` REST endpoints
for KB, CRM, CMS, Conversations, and Analytics so an agent can move an org's data
between a self-hosted server and the cloud in either direction. Imports upsert by
natural key where one exists and return an `idMap` for foreign-key remapping;
embeddings are regenerated on import; secrets are redacted and re-entered on the
target; CMS asset bytes are copied to the target's storage. Adds
`skill://playbooks/data-migration`.
