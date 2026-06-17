---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
'@getmunin/types': minor
---

Auto-provision the Threll webhook subscription when creating a Threll voice channel.

Munin now uses the Threll API key to register the webhook subscription with Threll (`POST /accounts/{accountId}/webhook-subscriptions`, `eventType: "*"`) and stores the signing secret Threll returns — the admin no longer generates a secret and pastes it into Threll. Provisioning happens atomically during channel create: the channel id is minted up front and the Threll call runs before the row is inserted, so if provisioning fails nothing is persisted and the dashboard shows a retry-only error. The webhook URL is built from the canonical server-side API base (`readApiBaseUrl()` / `MUNIN_API_URL`). The webhook signing secret is now Threll-owned and immutable, so the manual webhook-secret field is removed from the Threll create and edit dialogs. `ConfigureThrellBody` and the Threll MCP configure tool no longer accept `webhookSecret` on create. The Vapi flow is unchanged.
