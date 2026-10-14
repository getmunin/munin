---
'@getmunin/dashboard-pages': patch
'@getmunin/backend-core': patch
---

The channel dialog's Knowledge tab only shows the store and booking pickers when the org has a connection of that kind, instead of a "None connected" row for each. The space-count summary beside the tab label is gone.

Deleting a connection that is pinned to a channel now names those channels in the dashboard error. `connectors_connection_bound` carries a `params.channels` field, and the dashboard's error translator interpolates `params` from any error body into its message.
