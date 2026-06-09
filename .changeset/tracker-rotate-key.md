---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

Add tracker key rotation for analytics trackers.

Settings → Channels has long exposed a "Rotate key" action that revokes the active `mn_widget_*` key and mints a fresh one. Settings → Analytics trackers had no equivalent — only the identity-verification secret could be rotated, leaving operators stuck with `analytics_revoke_tracker` + `analytics_create_tracker` (which loses the tracker's name and config) if a `mn_track_*` key leaked.

Adds the missing symmetric action:

- New `analytics_rotate_tracker_key` MCP tool that revokes the tracker's active `mn_track_*` keys and mints a fresh one.
- New `POST /v1/analytics/trackers/:id/rotate-key` endpoint.
- Dashboard now shows "Rotate tracker key" above "Rotate identity secret" on each tracker row, with a one-time copy dialog matching the channels flow.
