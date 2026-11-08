---
"@getmunin/backend-core": patch
---

The lead-import and customer-onboarding skills (and the support-desk-launch playbook) now find existing companies with one `crm_lookup_companies` call, by business registration or domain, before creating any, and pass the registration to `crm_create_company`. The onboarding skill also stops claiming that `crm_create_company` dedupes by domain, and its examples now use the real argument shapes: `patch.companyId` on `crm_update_contact`, `customFields` instead of `metadata` on contacts, a valid activity type, and `entityType` + `id` on `crm_set_ai_summary`.
