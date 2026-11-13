---
"@getmunin/db": minor
"@getmunin/backend-core": minor
---

CRM companies can carry their legal identity: a registration country (ISO 3166 alpha-2) and the number the national business registry issued there. Numbers are normalized before they are stored (spaces, dots and dashes removed; Norway's `NO` prefix and `MVA` suffix, Sweden's VAT form and twelve-digit form, Denmark's and Finland's `DK`/`FI` prefixes stripped; short UK Companies House numbers zero-padded) and the check digit is verified for NO, SE, DK and FI. An org can hold each registration at most once, so creating a second company with the same country and number fails with `crm_company_registration_conflict` naming the company that already holds it. CRM export carries the registration, and import matches an existing company by registration before falling back to domain and name.

Owner fields now have to name a member of the org. `createCompany` accepts an owner, and setting an owner on a contact (directly or through a merge proposal's recommended patch) that belongs to someone outside the org fails with `crm_invalid` instead of storing a foreign user id.
