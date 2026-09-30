---
"@getmunin/backend-core": patch
"@getmunin/dashboard-pages": patch
---

Signing up no longer grants organization membership to an email address that hasn't been proven.

- Invitation acceptance is bound to the invited address: the signed-in account's email must match the invitation, otherwise the request is refused with `invitation_email_mismatch`. Acceptance is claimed atomically, so an invitation is consumed exactly once; accepting again as the same account (a reload or a double submit) succeeds without side effects, while any other account gets a 409. The invitee receives the invited role even when they already joined as a member. Accepting marks the account's email as verified, since the invitation link was delivered to that mailbox.
- `createMuninAuthCore` accepts an `afterEmailVerification` hook, and `SignupHookUser` carries `emailVerified`, so a deployment can defer membership until the address is confirmed.
- Account linking now keeps BetterAuth's default of requiring a verified local email before a Google or GitHub sign-in is attached to an existing password account, and resetting a password revokes the account's other sessions.
- The dashboard's sign-up and sign-in forms send an account that has no organization yet to a "confirm your email" page instead of an empty dashboard, and the invitation page explains an email mismatch.

Self-hosted single-org deployments: a new sign-up on an allowlisted domain joins the organization only after opening the verification link, and an invited sign-up joins by accepting the invitation link rather than at sign-up time. The first account on a fresh install still becomes the owner immediately.
