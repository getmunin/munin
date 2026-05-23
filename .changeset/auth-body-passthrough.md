---
'@getmunin/backend-core': patch
---

Forward the raw request body to Better Auth instead of re-serializing it as JSON. The OAuth token endpoint requires `application/x-www-form-urlencoded` per RFC 6749 §3.2; the previous handler converted every body to JSON and set `Content-Type: application/json`, so Better Auth rejected token exchanges with `UNSUPPORTED_MEDIA_TYPE`. Externally-RFC-compliant clients like claude.ai web therefore never received an access token. Other Better Auth endpoints (sign-in, register, consent) happen to accept JSON, which is why the bug stayed latent until claude.ai connected.

The handler now passes `req.rawBody` through verbatim (Nest's `rawBody: true` already captures it), preserving the original content-type. JSON fallback is kept for safety when no raw body was captured.
