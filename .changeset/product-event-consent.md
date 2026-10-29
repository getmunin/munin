---
'@getmunin/backend-core': minor
---

A product event can now record the lawful basis a sign-up gave, so a sign-up sync can start a marketing journey for someone Munin has never seen.

- **`consent` on `POST /v1/events`.** Each event may carry `consent: { lawfulBasis, source, givenAt?, evidence? }`, where `lawfulBasis` is `contract`, `consent` or `legitimate_interest`. Munin records it on the person before it emits the event, inside the same transaction, so a journey the event starts already sees the basis and a fixed-text welcome email is not skipped with `no_lawful_basis`. `givenAt` defaults to the event's `occurredAt`, and the evidence also names the event that carried it.
- **Contacts for new sign-ups.** An event that carries `consent` and whose identity matches no contact creates one from the identity's email (and phone), linked to the end user. Without `consent`, events still create no contact.
- **Never overwrites.** A basis already on record is kept, and recording one never lifts an unsubscribe or a do-not-contact mark. Each result reports `consent: "recorded"` or `"kept"`, and a retried event id records nothing again.
- **Guarded.** Recording consent needs a key with `crm:write` as well as `analytics:write`; a key with only `analytics:write` gets `403 analytics_forbidden`. Consent for an unverified identity, for an identity with neither a contact nor an email, or with a `givenAt` in the future is refused with `400 analytics_invalid`.
- The trial onboarding playbook and `skill://journeys/build-journey` explain the field, and the playbook's example segment now filters on the `trial.started` event instead of a tag nothing sets.
