---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
'@getmunin/docs-pages': minor
'@getmunin/inspector-app': minor
'@getmunin/types': minor
---

Rename MCP tools so a tool's name says which surface it acts on, and add a test that keeps names and titles in agreement

The channel tools were the worst offenders: `conv_test_channel` and `conv_send_channel_test` sounded universal but only resolve vendors in the voice/SMS adapter registry, so calling either on an email channel failed with `unknown channel vendor 'smtp'`. Meanwhile `conv_create_channel` sounded universal but only handles email and chat. The unqualified names were the narrow ones, and three verbs (`create` / `setup` / `configure`) meant the same action across three channel families. Renames:

- `conv_setup_email_channel` → `conv_configure_email_channel`
- `conv_send_email_test` → `conv_send_email_channel_test`
- `conv_widget_create_channel` → `conv_create_widget_channel`
- `conv_widget_update_channel` → `conv_update_widget_channel`
- `conv_widget_rotate_key` → `conv_rotate_widget_key`
- `conv_widget_rotate_identity_secret` → `conv_rotate_widget_identity_secret`
- `conv_configure_channel` → `conv_configure_voice_sms_channel`
- `conv_test_channel` → `conv_test_voice_sms_channel`
- `conv_send_channel_test` → `conv_send_voice_sms_channel_test`
- `conv_list_channel_vendors` → `conv_list_voice_sms_vendors`

`conv_create_channel` now rejects `voice` and `sms` at the schema instead of asking the model not to pass them. Taking that path used to insert a row with `active: true`, no adapter binding and no credential link — a channel that looked configured and could not send. `conv_import` still accepts all four types, since importing historical conversations is not the same as provisioning transport.

Elsewhere the same operation carried different verbs, and four singular/plural pairs were distinguished by one letter where the rest of the surface uses `get_X` / `list_Xs`:

- `crm_find_contact` → `crm_lookup_contact` (matches the connector modules' `lookup` for keyed-by-email reads)
- `bookings_lookup_bookings` → `bookings_list_guest_bookings`
- `bookings_get_my_bookings` → `bookings_list_my_bookings`
- `commerce_lookup_orders` → `commerce_list_customer_orders`
- `commerce_get_my_orders` → `commerce_list_my_orders`
- `crm_change_stage` → `crm_change_deal_stage`
- `cms_search` → `cms_search_entries`
- `slack_test` → `slack_send_test_message`
- `kb_import_website_status` → `kb_get_website_import_status`
- `outreach_propose_initial` → `outreach_propose_initial_message`
- `analytics_get_traffic_by_source` → `analytics_list_traffic_sources`
- `feedback_get` → `feedback_get_item`, `feedback_create` → `feedback_create_item`, `feedback_list` → `feedback_list_pending_items`, `feedback_search` → `feedback_search_roadmap`, `feedback_vote` → `feedback_vote_on_roadmap_item`

The `feedback_*` prefix covered two unrelated corpora with nothing in the names to say so: `feedback_list` reads the local outbox awaiting admin action, while `feedback_search` queries the public Munin roadmap.

Descriptions that no longer matched behaviour are corrected. `outreach_propose_initial_message` and `outreach_approve_proposal` still described email-only sends after SMS and voice campaigns shipped; approving now documents an email, an SMS, or an outbound call, and `outreach_propose_followup` states that sequences are email-only. `conv_list_channels` claimed `voice` and `sms` were "reserved for upcoming adapters" — both have shipped. `conv_request_channel_credentials` is generically named and generically implemented but claimed to be email-only, so an agent holding a pending Twilio channel would have skipped the one tool that mints its credential link.

Titles now restate their tool's name rather than drifting from it — they are what a host shows in a permission prompt. Analytics titles were noun phrases ("Top referrer hosts") where the rest of the surface is imperative, and the bookings titles said "Book a table" for a vendor-agnostic bookings contract that also serves non-restaurant venues.

`tool-naming.test.ts` boots the registry and asserts, across every registered tool, that names carry a known module prefix, that titles start with that module's display prefix, and that a title's leading word matches the verb in its name. It caught two tools this pass that the manual review missed: `conv_widget_rotate_key` and `conv_widget_rotate_identity_secret` kept the family-before-verb shape, and `conv_request_callback` was titled "Place a phone call…" against a name that promises a request.
