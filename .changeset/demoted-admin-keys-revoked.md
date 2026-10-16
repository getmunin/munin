---
'@getmunin/backend-core': patch
'@getmunin/core': patch
---

Demoting an owner or admin to member now revokes the `mn_admin_*` API keys they created, the same way removing them from the organization already did. A revoked key stays dead if the person is promoted again.

Admin keys also stop resolving as soon as the person who created them is no longer an owner or admin, even if the key was never revoked. This covers keys left over from demotions made before this change: they could still call admin MCP tools and the `/v1` export and import routes.
