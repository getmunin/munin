---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
'@getmunin/core': minor
---

Admin API keys can now be scoped to just the modules they need, instead of only ever being minted with full (`*`) access. The dashboard's "Mint API key" dialog gained a "Full access" toggle (on by default) and, when off, a per-module read/write picker reusing the same module list and descriptions as the OAuth consent screen; the key list now shows a scope summary per key.

The scope check already existed for MCP tool calls (`dispatch.ts`'s `hasScope`); this extends it to direct `/v1` REST calls by annotating each module's controller with `@AdmitAdminKeyScope`, so a scoped key behaves the same whether called over MCP or REST. Org/account-administration routes (API keys themselves, members, invitations, billing, and anything else gated by `@RequireRole`) stay `*`-only regardless of which module scopes a key holds — a scoped key can never mint a more-privileged key or manage the team.
