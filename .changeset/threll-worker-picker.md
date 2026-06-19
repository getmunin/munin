---
"@getmunin/backend-core": patch
"@getmunin/dashboard-pages": patch
"@getmunin/types": patch
---

feat(channels): pick voice options from a dropdown, discover them over MCP, and dedup the Threll webhook

Setting up a voice channel no longer makes you hand-type opaque ids. For Threll you now enter just the API key and press Continue — the account is resolved from the key (via `GET /v1/accounts/current`, since a key maps 1:1 to an account) and the dialog fetches that account's workers into a dropdown; nothing is persisted until you pick a worker and confirm, so cancelling leaves no channel and no webhook subscription behind. Vapi follows the same two-step shape: enter the API key (and optional public key / phone number id), press Continue, then pick the assistant from a dropdown — no more hand-typed assistant id. Edit dialogs load the same dropdowns from the channel's stored credentials.

The Threll account ID is no longer required input anywhere (MCP `conv_configure_channel` / control-plane / dashboard) — it's derived from the key when omitted (still accepted as an optional override, and re-derived if the API key is rotated on edit). It's still persisted and shown as a chip on the channel row.

Option discovery is exposed generically so agents get parity with the dashboard: a new `conv_list_channel_options` MCP tool returns a vendor's selectable options (Threll `workers`, Vapi `assistants`) as `{ value, label, hint }` groups — pass `vendor` + credentials before the channel exists, or `channelId` for an existing one. Adding discovery for a new vendor is just a `listOptions` method on its `ChannelAdminProvider`. The control plane exposes the same via `POST /v1/conversations/channels/options` and `POST /v1/conversations/channels/:id/options`.

Threll webhook auto-setup now lists the account's existing subscriptions and reuses a matching one's signing secret instead of blindly creating another. The post-setup "webhook URL" screen is gone — Munin registers the webhook with Threll automatically.

Vapi now auto-configures its webhook too: on create, Munin points the chosen assistant's `server` at the channel's webhook URL (with the shared-secret header) — but only when that server is unset or already a Munin URL, so it never clobbers an assistant you've wired elsewhere (in which case it falls back to the manual connection screen). The prior server config is stashed and restored when the channel is archived, via a new best-effort `onArchive` provider hook.

When auto-setup would collide with an existing webhook, Munin now asks instead of failing. Threll rejects a second account-wide `*` subscription, and Vapi's server URL may already point elsewhere — in both cases setup now returns a `409 webhook_conflict` and the dashboard shows a "Replace existing webhook?" confirm. Confirming retries with `replaceWebhook: true` (Threll deletes the conflicting subscription and registers its own; Vapi overwrites the assistant's server URL); cancelling goes back with nothing changed. The flag is exposed on `conv_configure_channel` too, so agents can resolve the conflict the same way.

Internal: the Threll and Vapi HTTP clients now route every call through one `request` helper that centralizes auth headers, timeouts, and status→error mapping; the dashboard `ApiError` now surfaces the response `code` so callers can branch on `webhook_conflict`.
