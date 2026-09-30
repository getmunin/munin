---
'@getmunin/backend-core': minor
---

`GET /v1/me/memberships` now returns each org's `logoUrl` (the same versioned public URL as `GET /v1/orgs/me`, or `null` when the org has no logo), so an org switcher can show every org's logo without one request per org.
