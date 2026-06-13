---
'@getmunin/backend-core': minor
'@getmunin/agent-runtime': patch
'@getmunin/core': patch
'@getmunin/dashboard-pages': patch
---

Rename MCP tools for naming consistency. The dominant convention is `<module>_<verb>_<object>`; these tools deviated and have been renamed:

- `crm_propose_merge_candidate` → `crm_propose_merge` (the other merge tools all say "proposal", not "candidate")
- conv channel admin (verb/object order): `conv_channel_configure` → `conv_configure_channel`, `conv_channel_test` → `conv_test_channel`, `conv_channel_send_test` → `conv_send_channel_test`
- conv email: `conv_email_setup_channel` → `conv_setup_email_channel`, `conv_email_test_channel` → `conv_test_email_channel`, `conv_email_send_test` → `conv_send_email_test`
- voice ("call", not voice/phone split): `conv_voice_call` → `conv_call_channel`, `conv_voice_call_contact` → `conv_call_contact`
- end-user self-service (drop awkward possessive/suffix): `crm_log_activity_self` → `crm_log_my_activity`, `conv_request_handover_in_my_conversation` → `conv_request_human`, `conv_request_phone_call_for_my_conversation` → `conv_request_callback`
- analytics report tools (add the verb the rest of the surface uses): `analytics_top_subjects` → `analytics_list_top_subjects`, `analytics_top_countries` → `analytics_list_top_countries`, `analytics_traffic_by_source` → `analytics_get_traffic_by_source`, `analytics_referrer_hosts` → `analytics_list_referrer_hosts`, `analytics_views_over_time` → `analytics_get_views_over_time`, `analytics_subject_engagement` → `analytics_get_subject_engagement`, `analytics_contact_journey` → `analytics_get_contact_journey`, `analytics_zero_result_searches` → `analytics_list_zero_result_searches`

Breaking for MCP clients pinned to the old tool names.
