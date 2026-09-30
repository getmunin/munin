---
'@getmunin/backend-core': patch
---

Harden the OAuth client icon endpoint (`GET /v1/oauth/clients/:id/icon`). The icon is fetched from a URL chosen by whoever registered the client, and registration needs no account, so the endpoint no longer passes through SVG images — an SVG can carry script, and it was served from the API origin. Only raster formats (PNG, JPEG, GIF, WebP, ICO) are proxied now; anything else falls back to the built-in generic icon. Every icon response, including that fallback, now carries a sandboxing `Content-Security-Policy`, `X-Content-Type-Options: nosniff` and an inline `Content-Disposition`, and the upstream body is streamed against the 256 KB cap instead of being buffered whole before the size check.
