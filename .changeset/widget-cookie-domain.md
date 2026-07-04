---
'@getmunin/chat-widget': patch
'@getmunin/backend-core': patch
'@getmunin/docs-pages': patch
---

widget: add `data-munin-cookie-domain` so a conversation can be shared across sibling subdomains

The session and visitor ids are kept in `localStorage` with a cookie fallback, and both were host-only — a chat started on `www.example.com` did not carry over to `app.example.com`. Setting `data-munin-cookie-domain=".example.com"` now writes the session + visitor cookies with that `Domain`, so both subdomains read the same ids and the anonymous thread is claimed when the visitor signs in on the app. The value must be a suffix of the page's host or it is ignored (a rejected `Domain` would silently break persistence). Default behavior is unchanged (host-only).
