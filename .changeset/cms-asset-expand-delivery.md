---
'@getmunin/backend-core': minor
---

feat(cms): expand asset fields inline on read paths. The public delivery API (`/v1/cms/:org/:collection[/:slug]`), admin `cms_get_entry` / `cms_list_entries`, and `cms_search` previously returned bare asset ids (e.g. `"cma_xyz"`) for `type: 'asset'` and `array<asset>` fields, leaving external renderers no way to derive a URL. Reads now replace those ids with `{ id, publicUrl, altText, mime, sizeBytes }` via a single batched, org-scoped `cms_assets` lookup per response. Pending (`uploaded=false`) and unknown ids surface as `null` so renderers can treat them as missing rather than render a broken id. Write paths (`cms_create_entry` / `cms_update_entry` / publish / restore) intentionally stay raw so agent round-trips remain clean.

Also: new CMS uploads are now keyed under `cms/{orgId}/...` instead of `{orgId}/...` so bucket policies can scope `s3:GetObject` to `cms/*` and the same bucket can later hold non-public objects without exposing them. Existing rows keep working — `publicUrl` is stored absolute, so old keys are unaffected.
