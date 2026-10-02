---
'@getmunin/backend-core': minor
---

Add `MembershipHooksModule.forRoot({ afterLastMembershipRemoved })`. When an owner removes a member who has no other membership left, the hook runs inside the removal transaction with the removed user, so a deployment can give that user somewhere to land, such as a fresh org to set up. Without a registered hook, removal behaves as before.

`POST /v1/invitations/accept` is now reachable when `AuthGuard` is registered as a global guard. It still requires a signed-in session, which its own guard checks, but no longer requires that session to belong to an org already. A user with no memberships can now accept an invitation.
