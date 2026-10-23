---
"@getmunin/backend-core": patch
---

Self-hosted `docker compose` builds now always pull the latest `node:24-alpine` base image instead of reusing a cached one, so a rebuild picks up Node.js security releases. The 2026-10-21 Node.js releases (24.22.1) fix a Brotli decoder out-of-bounds write that permits remote code execution and two TLS certificate hostname-validation bypasses; outbound `fetch` decodes Brotli responses, so website imports reach the affected code. If your images were built before 2026-10-21, rebuild and restart with `docker compose up -d --build`.
