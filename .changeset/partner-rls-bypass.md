---
'@getmunin/core': patch
'@getmunin/db': patch
'@getmunin/types': patch
'@getmunin/sdk': patch
'@getmunin/mcp-toolkit': patch
'@getmunin/bootstrap': patch
'@getmunin/ui': patch
'@getmunin/dashboard-pages': patch
'@getmunin/backend-core': patch
---

TenancyInterceptor: bypass RLS for `actor.type === 'partner'`.

Partner actors (cloud-only) operate across multiple orgs they
provisioned. Their controllers filter manually by `partner_id`. OSS
never produces `'partner'` actors, so this branch is dead code there.
