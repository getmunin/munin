---
"@getmunin/core": patch
"@getmunin/backend-core": patch
---

Clear every `pnpm audit` advisory. undici moves to 7.29.1 (TLS validation bypass in `BalancedPool`, WebSocket crash paths, shared-cache cookie disclosure) and nodemailer to 10.0.13 (quadratic backtracking in the address parser, cross-transport TLS server-name reuse, recipient-array stack exhaustion), with mailparser raised to 3.9.32 so inbound parsing and outbound sending share one nodemailer. nodemailer 10 ships its own type declarations, so `@types/nodemailer` is dropped. multer is lifted to 2.4.0 for the aborted-upload disk-write DoS; the remaining advisories were build- and dev-tree only and are pinned through overrides.
