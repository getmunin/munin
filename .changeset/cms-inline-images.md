---
"@getmunin/backend-core": minor
"@getmunin/db": minor
---

CMS: support inline images in entry bodies. Embed an `asset://<assetId>` reference inside a `markdown`/`rich_text` field and the delivery API, `cms_get_entry`, and `cms_search` resolve it to the asset's `publicUrl` plus an `_assets` sidecar map. Inline references are validated on write (an unknown or unconfirmed asset is rejected). Asset references — inline and typed fields alike — are now tracked, so `cms_delete_asset` refuses to delete an asset still in use, and a new `cms_list_asset_usage` tool reports which entries reference an asset.
