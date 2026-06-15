---
"@getmunin/backend-core": patch
---

Fix CMS draft review 404: the admin `GET /v1/cms/drafts/:id` route was shadowed by the public delivery wildcard `GET /v1/cms/:orgId/:collectionSlug`. Both are 4-segment routes that match `/v1/cms/drafts/<id>`, and the public controller was registered first (first-match-wins), so draft reads resolved to `resolveOrg("drafts")` and 404'd before reaching the auth-guarded handler. `CmsDraftsController` is now registered before `CmsDeliveryController`.
