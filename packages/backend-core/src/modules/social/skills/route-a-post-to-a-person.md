---
title: 'Social: Route a post to someone who can publish it'
description: Check who in the organisation has connected a social account, set a draft's suggested author to one of them, and say plainly what to do when nobody has connected one or a connection has lapsed.
audiences: [admin]
---

# Route a post to someone who can publish it

A social post draft is published by a person, from their own account. Munin holds a
grant for each person who has connected one, and publishes through that grant when the
person clicks publish on the draft. A draft nobody can publish is a draft that sits in
the review queue until it goes stale, so set `suggestedUserId` to someone who actually
has a working connection.

## Find out who can post

Call `social_list_connected_accounts`. Each entry carries:

- `userId` — the value to pass as `suggestedUserId` on a draft.
- `platform` and `displayName` — which account it is.
- `status` — `active`, `expired` or `revoked`.
- `expiresSoon` — true when the grant runs out within a week.
- `canRefresh` — whether the grant renews itself.

Only an `active` account can publish. Prefer one that is `active` and not `expiresSoon`.

## Setting the author on a draft

Pass `suggestedUserId` to `social_propose_post_set` or `social_create_post_draft`. It is
a suggestion about who should review and publish, not an assignment, and it does not
grant anyone anything: a post is always published from the connected account of the
person who clicks publish. Routing a draft to someone who has no connection simply means
whoever picks it up publishes it from their own account instead. Spread a set of
variants across different people only if the operator asked for that — the usual case is
one author for the whole set.

## When nobody can publish

Two situations, and they need different things said.

**No accounts at all.** Nobody has connected one yet. Still file the drafts — they are
useful the moment someone connects — and say in your summary that the posts are waiting
on a connection, which an operator makes from Settings → Integrations. Do not invent a
`suggestedUserId`; leave it unset.

**Every account is `expired` or `revoked`.** The grant ran out and the person has to
authorize again. Munin has already raised an alert for them and emailed them about it,
so do not treat this as something you can fix — file the drafts, leave
`suggestedUserId` unset or pointing at the lapsed person, and note it.

`canRefresh: false` is normal rather than a fault. LinkedIn issues a renewable grant
only to approved Marketing Developer Platform partners; an organisation on the
self-serve "Share on LinkedIn" product gets a 60-day grant with nothing to renew it
with, so its accounts lapse on a schedule and the person reconnects. Do not report that
as a misconfiguration.

## What not to do

- Do not publish a draft yourself as part of routing it. `social_publish_post_draft`
  posts immediately and irreversibly from the account of whoever is calling, so it
  belongs to the person reviewing the draft, not to the job that filed it. See
  `skill://social/publish-a-reviewed-post`.
- Do not ask a person for their LinkedIn password or an access token. The only way an
  account is connected is the authorize link in the dashboard.
- Do not route a draft to someone because they wrote the underlying article. Being the
  author of an article is not the same as having connected an account.
