---
'@getmunin/dashboard-pages': minor
'@getmunin/backend-core': minor
---

The dashboard has a Journeys page. The list shows each journey's status and its live and draft versions. A journey's page draws its graph (live or draft, with how many people reached each step), lists the people in it with their state and where they are or why they left, opens a step-by-step trace for each person, reports goal conversion against the holdout and per-step outcomes, and lists every version with its change log.

Publishing happens here: "Review and publish" validates and simulates the draft, then shows what changed against the live version, which emails would send without review, any warnings, the dry-run counts and assumptions, and a rendered sample email. Confirming publishes exactly that version; a journey can also be paused and resumed from the page. The link an agent returns from `journeys_request_publish` opens this dialog directly. Enrollment listings now include the contact's name and email.
