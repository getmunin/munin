---
'@getmunin/backend-core': patch
'@getmunin/dashboard-pages': patch
---

Remove dashboard outreach campaigns config page. Campaign CRUD now lives only via the admin MCP tools (`outreach_create_campaign`, `outreach_update_campaign`, `outreach_list_campaigns`, `outreach_get_campaign`) — agent-native setup, dashboard-native review. Drops the `/dashboard/settings/outreach` route, the `OutreachCampaignsPage` export, and the `/api/outreach/campaigns` REST controller. The Review tab (`OutreachDraftsTab`) and `/api/outreach/proposals` are unaffected.
