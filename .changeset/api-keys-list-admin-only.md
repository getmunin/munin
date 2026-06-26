---
'@getmunin/backend-core': patch
---

fix(control): scope the API keys list to admin keys only

The dashboard "API keys" page is labelled "Admin keys for the Munin API", but `GET /v1/api-keys` returned every non-revoked key for the org regardless of type — so widget (`mn_widget_*`) and tracker (`mn_track_*`) keys leaked into the list.

`list()` now filters on `type = 'admin'`, and `revoke()` carries the same guard so this route can't revoke a widget/tracker key by id and bypass their dedicated rotation/cleanup flows (`analytics_revoke_tracker`, `conv_widget_rotate_key`). Revoking a non-admin key here now returns 404.
