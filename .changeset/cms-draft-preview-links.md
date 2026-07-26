---
'@getmunin/core': minor
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

CMS draft preview links: drafts can now be viewed rendered by the customer frontend before publishing. `cms_get_preview_link` (and `POST /v1/cms/drafts/:id/preview-link`, plus a Preview action in the inbox drawer) mints a signed, entry-scoped token valid for 1 hour; the public delivery API's single-entry route accepts it as `?preview=<token>` and returns the entry regardless of status with `Cache-Control: no-store` and a `status` field. Reference expansion under preview includes draft-status referenced entries so the previewed page is truthful. Collections can carry a `settings.previewUrl` template (`{token}`, `{slug}`, `{locale}`, `{collection}` placeholders) pointing at the frontend's draft-mode endpoint; the full frontend contract is documented in the new `skill://cms/preview-entry`. List and search delivery routes never accept preview tokens.
