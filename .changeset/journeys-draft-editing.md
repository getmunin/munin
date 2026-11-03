---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

The dashboard can edit journey drafts. These endpoints wrap the same service methods as the `journeys_*` draft tools:

- `PUT /v1/journeys/:id/draft` replaces the spec.
- `POST /v1/journeys/:id/draft/nodes` adds a step.
- `PUT` and `DELETE /v1/journeys/:id/draft/nodes/:nodeId` change or remove a step.
- `PATCH /v1/journeys/:id/draft/settings` changes the settings.

Every edit takes an optional `ifSpecHash`. If an agent or another person changed the draft after it was loaded, the edit is refused with `journeys_draft_changed`, so their work is never overwritten. A step id that already exists is refused with `journeys_node_exists`. The dashboard translates both codes.

Publishing is unchanged: a person still confirms the fingerprint in the publish dialog. `journeys_list_node_types` now describes SMS, chat and call steps as well as email.
