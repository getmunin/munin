---
'@getmunin/backend-core': minor
---

Lay groundwork for tier-aware quotas: split `QuotasService` into an abstract base + DI token + `DefaultQuotasService` so cloud can swap in a tier-aware implementation.

- New injection token `QUOTAS_SERVICE`; consumers (`KbService`, `CmsService`, `CrmService`) now inject via the token.
- `crm_contacts` joins the row-count quota set (`QuotaResource`, `FREE_TIER_QUOTAS`, `TABLE_FOR`) and `CrmService.createContact` gates on it. Still off by default — `MUNIN_QUOTAS_ENABLED=true` to enable.
- New `recordCall(kind, key?)` method on `QuotasService` for call-count metering (MCP tool invocations, REST requests). Default impl is a no-op; cloud will override to do tier-aware soft/hard caps with windowed counters.
- Seams: MCP dispatch wires `recordCall('mcp_tool', toolName)` through the existing `rateLimit` hook on the controller; a globally-registered `CallQuotaInterceptor` calls `recordCall('api_request', "<verb> <route>")` for `/v1` traffic.

OSS behavior unchanged: `recordCall` is a no-op everywhere on the default impl, and `assertCanAdd` still respects the `MUNIN_QUOTAS_ENABLED` gate.
