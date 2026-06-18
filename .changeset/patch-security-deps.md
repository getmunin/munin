---
"@getmunin/core": patch
"@getmunin/backend-core": patch
"@getmunin/agent-runtime": patch
---

Patch security-vulnerable dependencies. Bump nodemailer to ^8.0.9 (CRLF header injection, OAuth2 TLS certificate validation) and ws to ^8.21.0 (memory-exhaustion DoS), and force patched transitive versions of hono, form-data, multer, @opentelemetry/core, and @babel/core via pnpm overrides.
