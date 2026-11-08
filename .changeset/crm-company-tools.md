---
"@getmunin/backend-core": minor
"@getmunin/types": minor
---

New CRM company tools: `crm_get_company` (the company plus its live contact count and open deal count), `crm_search_companies` (name or domain fragment, or an exact registration number), `crm_lookup_companies` (check up to 200 registrations and 200 domains in one call and get back only the ones that already exist, plus any registration that is not a valid number for its country) and `crm_update_company` (partial patch with `fill-null` mode, matching `crm_update_contact`). `crm_create_company` accepts a `registration` and an `ownerUserId`, and `crm_list_companies` filters by tag, owner and `unowned`. Owner fields on company tools accept `"me"` for the signed-in person; a caller with no user, such as an API key, gets `crm_invalid`. Company updates emit the new `crm.company.updated` webhook event with the changed field names.
