---
"@getmunin/backend-core": patch
---

Tidy the MCP tools layer for consistency. No tool names, input schemas, or output shapes change.

- Analytics: moved tracker CRUD and all reporting queries out of `AnalyticsAdminTools` into `AnalyticsService`, leaving the tool methods as thin delegators (matching every other module). Inline Zod schemas are now named consts inferred with `z.infer`, dropping the hand-maintained arg types.
- Widget: extracted channel/key logic from `WidgetAdminTools` into a new `WidgetChannelAdminService`; the tool class now delegates.
- Shared the duplicated API-key minting and origin-allowlist checks (analytics + widget) into `common/` helpers.
- Renamed the vendor channel-admin files/classes that carried no `@McpTool` from `*.tools.ts`/`*AdminTools` to `*-admin.service.ts`/`*AdminService` (Twilio, MessageBird, Vapi, Threll).
- Standardized empty-input schemas on the shared `EmptyInput`, set both `readOnlyHint` and `destructiveHint` on every feedback/system-alerts tool, and fixed `system_alerts_*` title casing.
