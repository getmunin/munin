---
'@getmunin/dashboard-pages': patch
---

Resume a pending OAuth authorize instead of dropping it at the login page. When better-auth bounced `/auth/oauth2/authorize` to `/login` and the user already had a session, `redirectIfAuthenticated` ignored the OAuth query and redirected to `/dashboard`, stranding the connector mid-flow. It now detects authorize params (`response_type=code` + `client_id`) and redirects back to the authorize endpoint. The consent page's unauthenticated and switch-account bounces now carry the OAuth query to `/login` (the previous `?next=` param was never read, and its absolute URL would have been rejected anyway), so the existing post-sign-in resume logic completes the flow.
