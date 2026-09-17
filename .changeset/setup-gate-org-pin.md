---
'@getmunin/dashboard-pages': patch
---

Stop the onboarding gate from deadlocking against a pinned org.

The setup middleware decides whether onboarding is needed from the account's **default** membership. The client decided the same question from the **pinned** org in `sessionStorage`, which the middleware cannot see. When the two pointed at different orgs the page wedged: the client concluded setup was done and pushed to `/dashboard`, the middleware concluded it was not and redirected back to `/setup`, forever, on a spinner. `sessionStorage` survives a reload, so the loop outlived any amount of refreshing.

The setup gate now resolves the org the way the server does, and while onboarding is outstanding it repoints the pin at the org being onboarded. That second half matters on its own: `/v1/orgs/me` is scoped by the pin, so a stale pin meant the wizard's "name your workspace" step renamed a *different* org and left setup incomplete — re-entering the loop.

Multi-org tenancy is unaffected. The pin still governs every other surface; onboarding is simply about the default org, which is the one question where the two must agree.
