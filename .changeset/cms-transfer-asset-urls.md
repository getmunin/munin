---
'@getmunin/backend-core': minor
---

CMS export/import now moves content between orgs without putting image bytes in the payload.

- `cms_export` returns each asset with a `sourceUrl` (its public URL) instead of base64 bytes by default, and `cms_import` downloads from that URL on the server, behind the same SSRF guard and 50MB cap as `cms_upload_asset_from_url`. The export result stays small however many images the entries carry, so an agent can move a blog through two MCP calls without an API key. Pass `includeAssetBytes: true` to inline bytes as before, for when the importing server cannot reach the source's asset URLs.
- `cms_export` takes an optional `collections` list of slugs. The payload then holds only those collections, the locales their entries use, and the assets their entries reference (asset fields, asset arrays, assets inside blocks, and inline `asset://` links). An unknown slug fails with `cms_not_found`. `GET /v1/cms/transfer/export` accepts the same options as `?collections=a,b&includeAssetBytes=true`.
- Re-running an import now fills an asset placeholder that an earlier run left without bytes. The asset keeps its id, so entries that point at it stay linked.
- `POST /v1/cms/transfer/import` no longer drops `translationGroupId`. Entries imported over REST stay linked as locale variants when their slugs differ, matching the MCP tool. The two now share one Zod schema.
- `skill://cms/migrate-content` gains a section on copying collections between Munin orgs, and `skill://playbooks/data-migration` describes the new asset transfer.
