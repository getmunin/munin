---
"@getmunin/backend-core": minor
"@getmunin/dashboard-pages": minor
---

Pending invitations can now be resent from the Team page. An invitation that ran past its seven days used to sit in the pending list with only a revoke action, so the owner had to revoke it and type the address and role again. `POST /v1/orgs/me/invitations/:id/resend` replaces the invitation with a fresh one for the same address and role: a new link, a new seven-day expiry and a new email. The old link stops working. Invite links are stored only as hashes, so the original link cannot be sent again. Like creating an invitation, resending requires an owner signed in with a session. When no mail provider is configured, the dashboard shows the new link to copy, just as it does for a new invite.

The pending list now marks expired invitations as expired instead of only showing a relative time in the past, and highlights the resend action on them.
