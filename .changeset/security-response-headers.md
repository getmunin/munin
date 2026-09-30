---
'@getmunin/backend-core': patch
---

The API now sends baseline security headers on every response. All responses carry `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`, and `Strict-Transport-Security` is added when the public API URL (`MUNIN_API_URL`) is https. API and JSON responses additionally get `X-Frame-Options: DENY` and `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, so nothing the API returns can run script or be framed if a browser is sent to it directly. The auth error page keeps its inline styles.

Resources that customer sites load or open directly are left embeddable, so no CSP or frame restriction is added to them: the widget and tracker bundles, `/static/assets/*` (CMS assets, including inline PDFs), conversation attachment downloads, and the favicon and app icons. The `X-Powered-By` header is no longer sent.

The dashboard also refuses to be framed now (`X-Frame-Options: DENY`, `frame-ancestors 'none'`), which protects the login, consent and dashboard pages against clickjacking. It additionally sends `nosniff`, a `strict-origin-when-cross-origin` referrer policy, and a Permissions-Policy that turns off camera, geolocation, payment, USB and topics.
