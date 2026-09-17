---
'@getmunin/backend-core': minor
'@getmunin/dashboard-pages': patch
'@getmunin/db': minor
---

feat(social): connect a person's LinkedIn account so a reviewed draft has an author

Adds `social_accounts` — one grant per person per platform — and
`social_platform_apps`, the org's own OAuth client. A self-hoster cannot use
Munin's LinkedIn client, so client id and secret are per-org rows rather than
deployment environment variables, the same reasoning that put them on connector
connections.

The grant's refresh token is nullable, and that shapes the whole feature.
LinkedIn issues a renewable grant only to approved Marketing Developer Platform
partners; an organisation on the self-serve "Share on LinkedIn" product — the
product that grants `w_member_social`, and the one most orgs will be on — gets a
60-day access token and nothing to renew it with. So expiry is a normal event
here rather than a fault:

- A grant that carries a refresh token renews itself on use and nobody is told.
- A grant that does not lapses on schedule. An hourly sweep raises a warning a
  week ahead and an error once it is out, and because the alert is scoped to the
  person who owns the account rather than the org, it reaches the one individual
  who can act on it and nobody else.

Marking a lapsed grant unusable commits in its own transaction, separate from
the error handed back to the caller — doing it inside the transaction you then
throw out of rolls the marker back and leaves the account reporting healthy
while failing every call.

Two people in the same organisation cannot attach the same LinkedIn profile: the
second attempt is refused with `social_account_taken` rather than silently
re-pointing the first person's row.

Nothing here publishes. The grant exists so that a draft already approved by a
person has somewhere to go.

Adds `social_list_connected_accounts` and `skill://social/route-a-post-to-a-person`
so an agent can set `suggestedUserId` to someone who can actually publish, and
says plainly what to do when nobody can.
