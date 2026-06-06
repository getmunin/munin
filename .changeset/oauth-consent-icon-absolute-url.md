---
'@getmunin/backend-core': patch
---

`GET /v1/oauth/clients/:id` now returns `icon_url` as an absolute URL (e.g. `https://api.example.com/v1/oauth/clients/<id>/icon`) instead of a same-origin relative path. The consent page renders the icon via an `<img>` tag on the *web* origin, so when the API and web are on different origins (any deployment where backend ≠ web, including the standard cloud `api.getmunin.com` / `app.getmunin.com` split), the browser was requesting the icon from the wrong origin and falling back to the placeholder square. The base URL is taken from `authorizationServerUrl()` — the same env (`NEXT_PUBLIC_AUTH_URL` / `NEXT_PUBLIC_MCP_URL`) that drives every other public OAuth URL — so single-process OSS deployments where backend and web share an origin still render correctly.
