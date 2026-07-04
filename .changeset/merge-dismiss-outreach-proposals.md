---
"@getmunin/backend-core": patch
---

fix(crm): dismiss pending outreach proposals when a contact is merged

Applying a merge proposal archives the duplicate contact with `doNotContact: true` but previously left its pending outreach proposals bound to the now-suppressed tombstone. Approving one of those orphaned proposals then failed at the eligibility gate with `outreach_invalid: contact … is no longer eligible (suppression or consent withdrawn)`. The merge now dismisses the duplicate's pending proposals (with a `contact merged into <keeperId>` reason) and emits `outreach.proposal.dismissed` for each.
