---
'@getmunin/backend-core': minor
'@getmunin/db': minor
'@getmunin/types': minor
'@getmunin/dashboard-pages': minor
---

Journeys can follow a company instead of a person. With `entry.subject: "company"` a journey runs once per company, keyed `co:<companyId>`:

- **Entry.** An event from any of the company's people, or an event that carries `companyId`, enters it. A segment trigger enters each company with at least one eligible contact in the segment. `journeys_enroll` takes a `companyId`, or a contact whose company it then follows.
- **Goals, exits, re-entry and holdout** are all counted per company.
- **Branches** read the company's fields and tags, and product events from any of its people.
- **Actions.** `crm.add_tag` and `crm.remove_tag` tag the company, and `crm.log_activity` logs on the company. Person-only steps (`crm.update_contact`, waits on contact date fields) are refused by validation. Message steps in company journeys follow in the next release.
- **Data.** Runs store their company in a new `journey_enrollments.company_id` column (migration 0135).
- **Where it shows.** Enrollment lists show the company name, and the simulator samples companies for company journeys.
