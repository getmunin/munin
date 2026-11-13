---
"@getmunin/backend-core": patch
---

The lead-import and customer-onboarding skills (and the support-desk-launch playbook) now find existing companies with one `crm_lookup_companies` call, by business registration or domain, before creating any, and pass the registration to `crm_create_company`. The onboarding skill also stops claiming that `crm_create_company` dedupes by domain, and its examples now use the real argument shapes: `patch.companyId` on `crm_update_contact`, `customFields` instead of `metadata` on contacts, a valid activity type, and `entityType` + `id` on `crm_set_ai_summary`.

New skill `skill://crm/find-daily-prospects`: a seller's daily short list of companies in their territory that fit the org's ideal customer profile, each with a dated reason to call. Candidates come from company-data sources connected alongside Munin; one `crm_lookup_companies` call drops every company the CRM already knows, and the picks are stored as companies owned by the seller with a deal and the reason as the AI summary, so the next run never repeats them. It also sets the convention for a turned-down prospect: a `disqualified` tag with `prospectDisqualifiedReason` and an optional `prospectRetryAfter` date.
