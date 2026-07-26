---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
---

Auth: link Google/GitHub sign-ins to an existing account with the same verified email instead of failing with `account_not_linked`. OAuth errors now redirect to the app's login/signup page (via `errorCallbackURL`) instead of the API origin root, which returned a 404.
