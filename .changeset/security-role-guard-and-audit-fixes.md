---
'@getmunin/backend-core': patch
'@getmunin/agent-host': patch
'@getmunin/agent-runtime': patch
'@getmunin/db': patch
---

**Security**: address four audit findings.

- **High**: gate every sensitive control-plane endpoint on owner/admin role (webhooks, conversation channels, agent-config, org/assistant PATCH, etc.). Previously any signed-in member could rotate widget keys, change LLM provider credentials, or create event-exfiltrating webhooks.
- **High**: agent provider URLs (`providerBaseUrl`) now route through `safeFetch` (blocks private/loopback/link-local hosts) and reject `http://` unless `MUNIN_SSRF_ALLOW_PRIVATE` is set. Closes the SSRF + credential-exfil path that let a misconfigured base URL leak the provider API key.
- **High**: add RLS policy on `conv_widget_email_fallbacks` (the ledger had `org_id` but no policy). Plus a meta-test in `rls.test.ts` that fails when any `org_id`-bearing table is missing RLS.
- **Medium**: expand role-coverage integration tests to cover the newly-gated endpoints (webhooks, conv channels, org/assistant PATCH).

**Ergonomics**: introduce `@RequireRole(...)` / `@RequireActorType(...)` decorators + a single `RoleGuard` to replace inline `assertOwnerOrAdmin(...)` calls scattered across ~13 controllers. Conditional / body-dependent checks (`members:patch`) stay inline.
