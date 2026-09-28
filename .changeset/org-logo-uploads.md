---
'@getmunin/db': minor
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

Let an organization upload a logo.

Owners and admins can upload, replace and remove a logo from the Account settings page. The
control plane gains `PUT /v1/orgs/me/logo` (the raw image as the request body, its type as
`Content-Type`) and `DELETE /v1/orgs/me/logo`, and `GET /v1/orgs/me` now returns `logoUrl`, or
`null` when no logo is set. PNG, JPEG, WebP and SVG are accepted up to 2 MB; the bytes must
match the declared type, and a rejected upload answers `org_logo_unsupported_type` or
`org_logo_too_large`, both translated in the dashboard. Replacing or removing a logo deletes the
old object from asset storage.

Logos are served anonymously from `GET /v1/public/orgs/:orgId/logo`, and `logoUrl` carries a
version parameter so a replaced logo busts caches. They are never linked as raw storage URLs:
SVG can carry script, which is why CMS assets refuse it, so the logo endpoint serves every
format with a `sandbox` Content-Security-Policy and `nosniff`. A script inside an SVG logo
therefore cannot run, even when the file is opened directly rather than through `<img>`.

Migration `0110_org_logo` adds nullable `logo_storage_key`, `logo_mime` and `logo_updated_at`
columns to `orgs`. The logo lives in real columns rather than in `settings`, because
`PATCH /v1/orgs/me` replaces `settings` wholesale and would clobber it.

Uploads whose declared `Content-Length` exceeds the cap on the signed local-storage endpoint are
now answered with a 400 instead of having their connection reset.
