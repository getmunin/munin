---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
'@getmunin/types': minor
---

Journey steps with fixed text now run on their own once a person has read them at publish, and a changed email template holds sends instead of flooding the review inbox.

- **Approval defaults.** The built-in journey templates and new email and chat steps added in the dashboard start on `approval: "auto"`: the publish review is the read, and after that the message sends to each person without a review, still under consent, unsubscribe, quiet hours and the weekly cap. Agent-drafted steps stay `draft_only` until they earn `auto`, and a step without `approval` is still `draft_only`. The trial onboarding playbook and `skill://journeys/build-journey` explain when to pick which.
- **Template changes hold sends.** When an email template used by an `auto` step changes after publish, its emails stay approved and wait (re-checked hourly) instead of going back to review one by one, and one system alert per journey says it is holding emails. `journeys_get_template_changes` and `GET /v1/journeys/:id/template-changes` list the changed steps and how many emails are held; a signed-in person re-approves from the journey page, which shows the new template rendered with the step's text, re-pins the template and releases the held emails (`POST /v1/journeys/:id/template-changes/reapprove`, with the fingerprint from the list so a second change in between is refused). Emits `journey.templates.reapproved`.
- **Transactional SMS can run on `auto`.** A `class: "transactional"` SMS step — a booking confirmation, a reminder the contact asked for — may use `auto`. Marketing SMS and every call still need a person. The journey editor gains a message type select and offers `auto` only where it is allowed (`canSendWithoutReview` in `@getmunin/types`).
- **Consent shows up before publish.** `journeys_simulate` and the publish review warn (`no_lawful_basis`) when people in the sample would reach a marketing step without a recorded lawful basis, with how many. The trial onboarding playbook explains that product events never record consent, so the sign-up sync or an agent has to.
- The publish dialog lists the steps that send without review first.
