---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': minor
---

Opening an invitation link while signed out now shows who the invitation is for — the organization, the invited address and the role — instead of bouncing straight to the sign-in page. The page sends an invitee who already has an account to sign in and everyone else to create one, with the invited address filled in on both forms.

`GET /v1/invitations/lookup` now also returns `orgName` and `hasAccount`, and is rate-limited like the other public endpoints. Whether an account exists is only revealed for the one address the invitation token was sent to.
